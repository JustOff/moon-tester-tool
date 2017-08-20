"use strict";

var {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");

const pr = {PR_RDONLY: 0x01, PR_WRONLY: 0x02, PR_RDWR: 0x04, PR_CREATE_FILE: 0x08, PR_APPEND: 0x10, PR_TRUNCATE: 0x20};
var window = null, tempDir = null;

var styleSheetService = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
var amoCSS = Services.io.newURI("chrome://moonttool/content/amo.css", null, null);

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
	var manifestName = "chrome.manifest";

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

		var metainfs = zr.findEntries("META-INF/*"), metaArr = [];
		while (metainfs.hasMore()) {
			metaArr.push(metainfs.getNext());
		}

		var converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"]
						.createInstance(Ci.nsIScriptableUnicodeConverter);
		converter.charset = "UTF-8";

		var instFile = zr.getEntry(instName);
		var inputStream = zr.getInputStream(instName);
		var sis = Cc['@mozilla.org/scriptableinputstream;1'].createInstance(Ci.nsIScriptableInputStream);
		sis.init(inputStream);
		var instData = sis.read(instFile.realSize);
		sis.close();

		var manifestStream, hasManifest = zr.hasEntry(manifestName);
		if (hasManifest) {
			var manifestFile = zr.getEntry(manifestName);
			inputStream = zr.getInputStream(manifestName);
			sis.init(inputStream);
			var manifestData = sis.read(manifestFile.realSize);
			sis.close();

			manifestData = manifestData.replace(/^\xEF\xBB\xBF/, "");
			manifestData = manifestData.replace(/\{ec8030f7\-c20a\-464f\-9b0e\-13a3a9e97384\}/gi,
												"{8de7fcbb-c55c-4fbe-bfc5-fc555c87dbc4}");

			manifestStream = converter.convertToInputStream(manifestData);
		}
		zr.close();

		instData = instData.replace(/^\xEF\xBB\xBF/, "");
		instData = instData.replace(/<em:name>/ig, "<em:name>[TEST] ");
		instData = instData.replace(/em:name(\s+)?=(\s+)?\"/ig, 'em:name="[TEST] ');
		instData = instData.replace(/<em:targetApplication>[\s\S]+?<\/em:targetApplication>/i, "%PMcompatData%");
		instData = instData.replace(/<em:targetApplication>[\s\S]+?<\/em:targetApplication>/ig, "");
		instData = instData.replace(/<em:updateURL>[\s\S]+?<\/em:updateURL>/i, "");
		instData = instData.replace(/em:updateURL(\s+)?=(\s+)?\".+?\"/i, "");
		instData = instData.replace("%PMcompatData%",
									"<em:targetApplication><Description><em:id>{8de7fcbb-c55c-4fbe-bfc5-fc555c87dbc4}</em:id><em:minVersion>27.0.0a1</em:minVersion><em:maxVersion>*</em:maxVersion></Description></em:targetApplication><em:updateURL>https://localhost/update.xml</em:updateURL>");

		var isTheme = /<em:type>4<\/em:type>/.test(instData);
		if (isTheme) {
			instData = instData.replace(/\[TEST\]/g, "[FIX]");
			var cssFix = "chrome/browser/statusbar/overlay.css";
			var cssData = `@namespace url("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul");

#urlbar .urlbar-over-link-layer
{
	opacity: 0;
}

#urlbar .urlbar-over-link-layer[overlinkstate="fade-in"]
{
	-moz-transition-property: opacity;
	-moz-transition-duration: 150ms;
	opacity: 1;
}

#urlbar .urlbar-over-link-layer[overlinkstate="fade-out"]
{
	-moz-transition-property: opacity;
	-moz-transition-duration: 150ms;
	-moz-transition-timing-function: cubic-bezier(0.0, 1.0, 1.0, 1.0);
}

#urlbar .urlbar-over-link-layer[overlinkstate="showing"]
{
	opacity: 1;
}`;
			var cssStream = converter.convertToInputStream(cssData);
		}

		inputStream = converter.convertToInputStream(instData);

		var zw = Cc['@mozilla.org/zipwriter;1'].createInstance(Ci.nsIZipWriter);
		zw.open(tmpFile, pr.PR_RDWR);
		for (var metainf of metaArr) {
			if (metainf != "META-INF/") {
				zw.removeEntry(metainf, false);
			}
		}
		zw.removeEntry(instName, false);
		zw.addEntryStream(instName, Date.now(), Ci.nsIZipWriter.COMPRESSION_DEFAULT, inputStream, false);
		if (isTheme) {
			zw.addEntryStream(cssFix, Date.now(), Ci.nsIZipWriter.COMPRESSION_DEFAULT, cssStream, false);
		}
		if (hasManifest) {
			zw.removeEntry(manifestName, false);
			zw.addEntryStream(manifestName, Date.now(), Ci.nsIZipWriter.COMPRESSION_DEFAULT, manifestStream, false);
		}
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

	if (!styleSheetService.sheetRegistered(amoCSS, styleSheetService.USER_SHEET)) {
		styleSheetService.loadAndRegisterSheet(amoCSS, styleSheetService.USER_SHEET);
	}
}

function shutdown(data, reason) {
	if (reason == APP_SHUTDOWN) return;

	window = null;
	Services.obs.removeObserver(moonttoolObserver, "moonttoolEvent");
	AddonManager.removeInstallListener(installListener);

	if (styleSheetService.sheetRegistered(amoCSS, styleSheetService.USER_SHEET)) {
		styleSheetService.unregisterSheet(amoCSS, styleSheetService.USER_SHEET);
	}
}

function install() {};
function uninstall() {};
