import angular from "angular";

export default angular
  .module("webui.services.rpc.helpers", [
    "webui.services.deps",
    "webui.services.rpc",
    "webui.services.alerts",
    "webui.services.scheduler"
  ])
  .factory("$rpchelpers", [
    "$_",
    "$rpc",
    "$alerts",
    "$scheduler",
    function(_, rpc, alerts, scheduler) {
      var miscellaneous = { version: "", enabledFeatures: [] };
      // label of a queued URI download: the file name of its first URI
      var uriName = function(uris) {
        var u = (uris && uris[0]) || "";
        if (u.indexOf("magnet:") === 0) {
          var m = /[?&]dn=([^&]+)/.exec(u);
          try {
            return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : u.substr(0, 60);
          } catch (e) {
            return u.substr(0, 60);
          }
        }
        var path = u.split(/[?#]/)[0].replace(/\/+$/, "");
        var base = path.substr(path.lastIndexOf("/") + 1);
        try {
          base = decodeURIComponent(base);
        } catch (e) {}
        return base || u;
      };
      rpc.once("getVersion", [], function(data) {
        miscellaneous = data[0];
      });
      return {
        isFeatureEnabled: function(feature) {
          return miscellaneous.enabledFeatures.indexOf(feature) != -1;
        },
        getAria2Version: function() {
          return miscellaneous.version;
        },
        addUris: function(uris, settings, cb) {
          _.each(uris, function(uri) {
            var uri_parsed = [];
            // parse options passed in the URIs. E.g. http://ex1.com/f1.jpg --out=image.jpg --check-integrity
            var uriSettings = _.cloneDeep(settings);
            _.each(uri, function(uri_element) {
              if (uri_element.startsWith("--")) {
                var uri_options = uri_element.split(/--|=(.*)/);
                if (uri_options.length > 2) {
                  uriSettings[uri_options[2]] = uri_options[3] || "true";
                }
              } else {
                uri_parsed.push(uri_element);
              }
            });
            // the scheduler dispatches it now, or queues it when the max number of running downloads is reached
            scheduler.enqueue("addUri", [uri_parsed, uriSettings], uriName(uri_parsed), cb);
          });
        },
        addTorrents: function(txts, settings, cb, names) {
          _.each(txts, function(txt, i) {
            scheduler.enqueue(
              "addTorrent",
              [txt, [], settings],
              (names && names[i]) || "Torrent #" + (i + 1),
              cb
            );
          });
        },
        addMetalinks: function(txts, settings, cb, names) {
          _.each(txts, function(txt, i) {
            scheduler.enqueue(
              "addMetalink",
              [txt, settings],
              (names && names[i]) || "Metalink #" + (i + 1),
              cb
            );
          });
        }
      };
    }
  ]).name;
