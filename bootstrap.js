"use strict";

var {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");

function main(aSubject) {
	Cu.reportError("Run!");
}

var moonttoolObserver = {
	observe: function(aSubject, aTopic, aData) {
		if (aData == "Run") {
			main(aSubject);
		}
	}
};

function startup(data, reason) {
	Services.obs.addObserver(moonttoolObserver, "moonttoolEvent", false);
}

function shutdown(data, reason) {
	if (reason == APP_SHUTDOWN) return;
	
	Services.obs.removeObserver(moonttoolObserver, "moonttoolEvent");
}

function install() {};
function uninstall() {};
