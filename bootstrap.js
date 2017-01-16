"use strict";

var {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");

const pr = {PR_RDONLY: 0x01, PR_WRONLY: 0x02, PR_RDWR: 0x04, PR_CREATE_FILE: 0x08, PR_APPEND: 0x10, PR_TRUNCATE: 0x20};
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
	tempDir = tmpDir.clone();
	var instName = "install.rdf";

	try {
		srcFile.copyTo(tmpDir, "test-" + srcFile.leafName);
		var tmpFile = tmpDir.clone();
		tmpFile.append("test-" + srcFile.leafName);
	
		var zr = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(Ci.nsIZipReader);
		zr.open(tmpFile);
	
		if (!zr.hasEntry(instName)) {
			alert("Invalid XPI file!");
			zr.close();
			throw "Invalid XPI";
		}
	
		var instFile = zr.getEntry(instName);
		var inputStream = zr.getInputStream(instName);
		var sis = Cc['@mozilla.org/scriptableinputstream;1'].createInstance(Ci.nsIScriptableInputStream);
		sis.init(inputStream);
		var instData = sis.read(instFile.realSize);
		sis.close();
		zr.close();
		
		instData = instData.replace(/<em:targetApplication>[\s\S]+?<\/em:targetApplication>/ig, "");
		instData = instData.replace(/<em:updateURL>[\s\S]+?<\/em:updateURL>/ig, "");
		instData = instData.replace(/<em:name>/i, "<em:updateURL>https://localhost/update.xml</em:updateURL><em:targetApplication><Description><em:id>{8de7fcbb-c55c-4fbe-bfc5-fc555c87dbc4}</em:id><em:minVersion>27.0</em:minVersion><em:maxVersion>*</em:maxVersion></Description></em:targetApplication><em:name>[TEST] ");
//		Cu.reportError(instData);
		
		var converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"]
						.createInstance(Ci.nsIScriptableUnicodeConverter);
		converter.charset = "UTF-8";
		inputStream = converter.convertToInputStream(instData);
		
		var zw = Cc['@mozilla.org/zipwriter;1'].createInstance(Ci.nsIZipWriter);
		zw.open(tmpFile, pr.PR_RDWR);
		zw.removeEntry(instName, false);
		zw.addEntryStream(instName, Date.now(), Ci.nsIZipWriter.COMPRESSION_DEFAULT, inputStream, false);
		zw.close();

		window = aWindow;
		installFromFile(tmpFile);
	} catch(e) {
		Cu.reportError(e);
		clearTemp();
	}
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
