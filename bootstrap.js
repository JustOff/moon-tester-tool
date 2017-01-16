"use strict";

var {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");

var window = null, tempDir = null;

function installFromFile(aFile) {
	function doInstall(aInstall) {
		var installs = [ aInstall ];
		var webInstaller = Cc["@mozilla.org/addons/web-install-listener;1"]
							.getService(Ci.amIWebInstallListener);
		var browserElement = window.QueryInterface(Ci.nsIInterfaceRequestor)
							.getInterface(Ci.nsIDocShell).chromeEventHandler;
		webInstaller.onWebInstallRequested(browserElement, window.document.documentURIObject,
											installs, installs.length);
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

	var srcFile = fp.file;

	var tmpDir = FileUtils.getFile("TmpD", ["moonttool.tmp"]);
	tmpDir.createUnique(Ci.nsIFile.DIRECTORY_TYPE, FileUtils.PERMS_DIRECTORY);
	srcFile.copyTo(tmpDir, "test-" + srcFile.leafName);
	var tmpFile = tmpDir.clone();
	tmpFile.append("test-" + srcFile.leafName);
	
	window = aWindow;
	tempDir = tmpDir.clone();
	installFromFile(tmpFile);
}

function clearTemp() {
	if (tempDir && tempDir.exists()) {
		try {
			tempDir.remove(true);
		} catch(e) {}
		tempDir = null;
	}
	if (window) {
		window = null;
	}
}

var installListener = {
	onDownloadCancelled: function (aAddonInstall, aAddon) {
		clearTemp();
	},
	
	onDownloadFailed: function (aAddonInstall, aAddon) {
		clearTemp();
	},
	
	onInstallEnded: function (aAddonInstall, aAddon) {
		clearTemp();
	},
	
	onInstallCancelled: function (aAddonInstall, aAddon) {
		clearTemp();
	},
	
	onInstallFailed: function (aAddonInstall, aAddon) {
		clearTemp();
	}
}

var moonttoolObserver = {
	observe: function(aSubject, aTopic, aData) {
		if (aData == "Run") {
			main(aSubject);
		}
	}
};

function startup(data, reason) {
	AddonManager.addInstallListener(installListener);
	Services.obs.addObserver(moonttoolObserver, "moonttoolEvent", false);
}

function shutdown(data, reason) {
	if (reason == APP_SHUTDOWN) return;

	window = null;
	Services.obs.removeObserver(moonttoolObserver, "moonttoolEvent");
	AddonManager.removeInstallListener(installListener);
}

function install() {};
function uninstall() {};
