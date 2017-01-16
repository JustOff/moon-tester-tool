"use strict";

var {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");

var window = null;

function installFromFile(aFile) {
	function doInstall(aInstall) {
		var installs = [ aInstall ];
		var webInstaller = Cc["@mozilla.org/addons/web-install-listener;1"]
							.getService(Ci.amIWebInstallListener);
		var browserElement = window.QueryInterface(Ci.nsIInterfaceRequestor)
							.getInterface(Ci.nsIDocShell).chromeEventHandler;
		webInstaller.onWebInstallRequested(browserElement, window.document.documentURIObject,
											installs, installs.length);
		window = null;
	}

	AddonManager.getInstallForFile(aFile, function(aInstall) {
		doInstall(aInstall);
	});
}

function main(aWindow) {
	const nsIFilePicker = Ci.nsIFilePicker;
	var fp = Cc["@mozilla.org/filepicker;1"].createInstance(nsIFilePicker);
	fp.init(aWindow, "Select add-on to install", nsIFilePicker.modeOpen); 
	try {
		fp.appendFilter("Add-ons", "*.xpi");
		fp.appendFilters(nsIFilePicker.filterAll);
	} catch (e) {}

	if (fp.show() != nsIFilePicker.returnOK) {
		return;
	}

	var file = fp.file;
	window = aWindow;
	installFromFile(file);
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

	window = null;
	Services.obs.removeObserver(moonttoolObserver, "moonttoolEvent");
}

function install() {};
function uninstall() {};
