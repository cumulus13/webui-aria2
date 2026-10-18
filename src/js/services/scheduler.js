import angular from "angular";

// Download scheduler.
//
// Limits the number of simultaneously running downloads to `max`. Every add
// request (URI / torrent / metalink) that would exceed the limit is stored in
// a FIFO queue and dispatched to aria2 as soon as a running download finishes
// (or is paused / removed / errors out).
//
// Running downloads = aria2 "active" downloads (excluding torrents that are
// only seeding) + aria2 "waiting" downloads that are not paused.
//
// The queue and the settings are persisted in localStorage, the browser tab
// running the WebUI is what dispatches the queued items.

var STORAGE_KEY = "aria2scheduler";
var INFLIGHT_TTL = 5000; // ms a just-added download is reserved before it shows up in aria2 lists

export default angular
  .module("webui.services.scheduler", [
    "webui.services.deps",
    "webui.services.rpc",
    "webui.services.alerts",
    "webui.services.configuration"
  ])
  .factory("$scheduler", [
    "$_",
    "$rpc",
    "$alerts",
    "$schedulerDefaults",
    function(_, rpc, alerts, defaults) {
      var callbacks = {}; // queue item id -> add callback (not persistable)
      var seq = 0;
      var activeList = null; // last tellActive result (without seeders)
      var waitingList = null; // last tellWaiting result (without paused)
      var pendingAdds = 0; // add calls sent, response not received yet
      var inflight = []; // [{gid, t}] added, not yet visible in aria2 lists
      var storageWarned = false;

      var state = {
        enabled: !!defaults.enabled,
        max: Math.max(1, parseInt(defaults.maxDownloads, 10) || 1),
        queue: [],
        running: 0
      };

      function newId() {
        seq++;
        return Date.now().toString(36) + "-" + seq;
      }

      function load() {
        try {
          var raw = window.localStorage.getItem(STORAGE_KEY);
          if (!raw) return;
          var o = JSON.parse(raw);
          if (typeof o.enabled === "boolean") state.enabled = o.enabled;
          var m = parseInt(o.max, 10);
          if (m > 0) state.max = m;
          if (_.isArray(o.queue)) {
            state.queue = _.filter(o.queue, function(i) {
              return i && i.method && _.isArray(i.params);
            });
          }
        } catch (e) {
          console.log("scheduler: could not load state", e);
        }
      }

      function save() {
        try {
          window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ enabled: state.enabled, max: state.max, queue: state.queue })
          );
          storageWarned = false;
        } catch (e) {
          if (!storageWarned) {
            storageWarned = true;
            alerts.addAlert(
              "Scheduler: could not persist the download queue (browser storage full or disabled). Queued downloads will be lost on reload.",
              "error"
            );
          }
        }
      }

      load();

      // state.max can be temporarily invalid while the user is typing
      function maxSlots() {
        var m = parseInt(state.max, 10);
        return m > 0 ? m : 1;
      }

      function running() {
        if (activeList === null || waitingList === null) return null;
        return activeList.length + waitingList.length;
      }

      function freeSlots() {
        if (!state.enabled) return Infinity;
        var r = running();
        if (r === null) return 0; // not synced with aria2 yet
        return maxSlots() - r - pendingAdds - inflight.length;
      }

      function gidsOf(res) {
        if (_.isArray(res)) return res;
        return res ? [res] : [];
      }

      function dispatch(item) {
        pendingAdds++;
        var cb = callbacks[item.id];
        delete callbacks[item.id];
        rpc.once(
          item.method,
          item.params,
          function(d) {
            pendingAdds = Math.max(0, pendingAdds - 1);
            if (d && !d.code && d[0]) {
              var now = Date.now();
              _.each(gidsOf(d[0]), function(gid) {
                inflight.push({ gid: gid, t: now });
              });
            }
            if (cb) cb(d);
          },
          true
        );
      }

      function pump() {
        var sent = false;
        while (state.queue.length && freeSlots() > 0) {
          dispatch(state.queue.shift());
          sent = true;
        }
        if (sent) {
          save();
          rpc.forceUpdate();
        }
        state.running = (running() || 0) + pendingAdds + inflight.length;
      }

      function refreshInflight() {
        if (!inflight.length) return;
        var seen = {};
        _.each(activeList, function(d) {
          seen[d.gid] = true;
        });
        _.each(waitingList, function(d) {
          seen[d.gid] = true;
        });
        var now = Date.now();
        inflight = _.filter(inflight, function(e) {
          return !seen[e.gid] && now - e.t < INFLIGHT_TTL;
        });
      }

      rpc.subscribe("tellActive", [["gid", "status", "seeder"]], function(data) {
        if (!data || data.code || !data[0]) return;
        activeList = _.filter(data[0], function(d) {
          // a torrent that finished downloading and only seeds does not count
          return d.seeder !== "true";
        });
        refreshInflight();
        pump();
      });

      rpc.subscribe("tellWaiting", [0, 1000, ["gid", "status"]], function(data) {
        if (!data || data.code || !data[0]) return;
        waitingList = _.filter(data[0], function(d) {
          return d.status !== "paused";
        });
        refreshInflight();
        pump();
      });

      return {
        state: state,

        // Add one download. method: addUri | addTorrent | addMetalink,
        // params: the aria2 rpc params, name: label shown in the queue.
        enqueue: function(method, params, name, cb) {
          var item = {
            id: newId(),
            method: method,
            params: params,
            name: name || method,
            added: Date.now()
          };
          if (cb) callbacks[item.id] = cb;
          state.queue.push(item);
          save();
          pump();
          return item.id;
        },

        // dispatch a queued item right now, ignoring the limit
        startNow: function(item) {
          var idx = state.queue.indexOf(item);
          if (idx < 0) return;
          state.queue.splice(idx, 1);
          dispatch(item);
          save();
          rpc.forceUpdate();
        },

        remove: function(item) {
          var idx = state.queue.indexOf(item);
          if (idx < 0) return;
          state.queue.splice(idx, 1);
          delete callbacks[item.id];
          save();
        },

        move: function(item, delta) {
          var idx = state.queue.indexOf(item);
          var to = idx + delta;
          if (idx < 0 || to < 0 || to >= state.queue.length) return;
          state.queue.splice(idx, 1);
          state.queue.splice(to, 0, item);
          save();
        },

        clear: function() {
          state.queue.length = 0;
          callbacks = {};
          save();
        },

        // call after state.enabled / state.max were edited
        update: function() {
          var m = parseInt(state.max, 10);
          if (m > 0) {
            state.max = m;
            save();
          } // else: invalid (e.g. empty field while typing), last saved value stays on disk
          pump();
        },

        getRunning: function() {
          return state.running;
        }
      };
    }
  ]).name;
