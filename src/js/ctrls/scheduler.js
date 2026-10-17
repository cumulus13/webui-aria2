import angular from "angular";

export default angular
  .module("webui.ctrls.scheduler", [
    "webui.services.scheduler",
    "webui.services.modals"
  ])
  .controller("SchedulerCtrl", [
    "$scope",
    "$scheduler",
    "$modals",
    function(scope, scheduler, modals) {
      // sidebar panel: running / max and queue size
      scope.sched = scheduler;
      scope.manage = function() {
        modals.invoke("scheduler");
      };
    }
  ]).name;
