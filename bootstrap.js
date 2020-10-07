"use strict";

var Cc = Components.classes, Ci = Components.interfaces, Cu = Components.utils;

Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

const pr = {PR_RDONLY: 0x01, PR_WRONLY: 0x02, PR_RDWR: 0x04, PR_CREATE_FILE: 0x08, PR_APPEND: 0x10, PR_TRUNCATE: 0x20};
var tempDir;

function clearTemp() {
  AddonManager.removeInstallListener(installListener);
  if (tempDir && tempDir.exists()) {
    try {
      tempDir.remove(true);
    } catch(e) {}
    tempDir = null;
  }
}

var installListener = {
  onDownloadCancelled: () => { clearTemp(); },
  onDownloadFailed:    () => { clearTemp(); },
  onInstallEnded:      () => { clearTemp(); },
  onInstallCancelled:  () => { clearTemp(); },
  onInstallFailed:     () => { clearTemp(); }
}

function main(win) {
  let filePicker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
  filePicker.init(win, "Select add-on to install", Ci.nsIFilePicker.modeOpen); 
  try {
    filePicker.appendFilter("Add-ons", "*.xpi");
    filePicker.appendFilters(Ci.nsIFilePicker.filterAll);
  } catch(e) {}

  if (filePicker.show() != Ci.nsIFilePicker.returnOK) {
    return;
  }

  let srcFile = filePicker.file;

  let tmpDir = FileUtils.getFile("TmpD", ["moonttool.tmp"]);
  tmpDir.createUnique(Ci.nsIFile.DIRECTORY_TYPE, FileUtils.PERMS_DIRECTORY);
  tempDir = tmpDir.clone();
  let instName = "install.rdf";
  let manifestName = "chrome.manifest";

  try {
    srcFile.copyTo(tmpDir, "test-" + srcFile.leafName);
    let tmpFile = tmpDir.clone();
    tmpFile.append("test-" + srcFile.leafName);

    let zipReader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(Ci.nsIZipReader);
    zipReader.open(tmpFile);

    if (!zipReader.hasEntry(instName)) {
      win.alert("Invalid XPI file!");
      zipReader.close();
      throw "Invalid XPI";
    }

    let metainfs = zipReader.findEntries("META-INF/*"), metaArr = [];
    while (metainfs.hasMore()) {
      metaArr.push(metainfs.getNext());
    }

    let converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"].createInstance(Ci.nsIScriptableUnicodeConverter);
    converter.charset = "UTF-8";

    let instFile = zipReader.getEntry(instName);
    let inputStream = zipReader.getInputStream(instName);
    let sInputStream = Cc['@mozilla.org/scriptableinputstream;1'].createInstance(Ci.nsIScriptableInputStream);
    sInputStream.init(inputStream);
    let instData = sInputStream.read(instFile.realSize);
    sInputStream.close();

    let manifestStream, hasManifest = zipReader.hasEntry(manifestName);
    if (hasManifest) {
      let manifestFile = zipReader.getEntry(manifestName);
      inputStream = zipReader.getInputStream(manifestName);
      sInputStream.init(inputStream);
      let manifestData = sInputStream.read(manifestFile.realSize);
      sInputStream.close();

      manifestData = manifestData.replace(/^\xEF\xBB\xBF/, "");
      manifestData = manifestData.replace(/\{ec8030f7\-c20a\-464f\-9b0e\-13a3a9e97384\}/gi, "{8de7fcbb-c55c-4fbe-bfc5-fc555c87dbc4}");

      manifestStream = converter.convertToInputStream(manifestData);
    }
    zipReader.close();

    instData = instData.replace(/^\xEF\xBB\xBF/, "");
    instData = instData.replace(/<(em:)?name>/ig, "<$1name>[TEST] ");
    instData = instData.replace(/(em:)?name\s*=\s*"/ig, '$1name="[TEST] ');
    instData = instData.replace(/<em:targetApplication>[\s\S]+?<\/em:targetApplication>/i, "%compatDataA%");
    instData = instData.replace(/<targetApplication>[\s\S]+?<\/targetApplication>/i, "%compatDataB%");
    instData = instData.replace(/<(em:)?targetApplication>[\s\S]+?<\/(em:)?targetApplication>/ig, "");
    instData = instData.replace(/<(em:)?updateURL>[\s\S]+?<\/(em:)?updateURL>/i, "");
    instData = instData.replace(/(em:)?updateURL\s*=\s*".+?"/i, "");
    let compatData = "<em:targetApplication><Description><em:id>{8de7fcbb-c55c-4fbe-bfc5-fc555c87dbc4}</em:id><em:minVersion>27.0.0a1</em:minVersion><em:maxVersion>*</em:maxVersion></Description></em:targetApplication><em:updateURL>https://localhost/update.xml</em:updateURL>";
    instData = instData.replace("%compatDataA%", compatData);
    compatData = compatData.replace(/em:/gi, "");
    instData = instData.replace("%compatDataB%", compatData);

    let isTheme = /<(em:)?type>4<\/(em:)?type>/.test(instData);
    if (isTheme) {
      instData = instData.replace(/\[TEST\]/g, "[FIX]");
      let cssFix = "chrome/browser/statusbar/overlay.css";
      let cssData = `@namespace url("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul");

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
      let cssStream = converter.convertToInputStream(cssData);
    }

    inputStream = converter.convertToInputStream(instData);

    let zipWriter = Cc['@mozilla.org/zipwriter;1'].createInstance(Ci.nsIZipWriter);
    zipWriter.open(tmpFile, pr.PR_RDWR);
    for (let metainf of metaArr) {
      if (metainf != "META-INF/") {
        zipWriter.removeEntry(metainf, false);
      }
    }
    zipWriter.removeEntry(instName, false);
    zipWriter.addEntryStream(instName, Date.now(), Ci.nsIZipWriter.COMPRESSION_DEFAULT, inputStream, false);
    if (isTheme) {
      zipWriter.addEntryStream(cssFix, Date.now(), Ci.nsIZipWriter.COMPRESSION_DEFAULT, cssStream, false);
    }
    if (hasManifest) {
      zipWriter.removeEntry(manifestName, false);
      zipWriter.addEntryStream(manifestName, Date.now(), Ci.nsIZipWriter.COMPRESSION_DEFAULT, manifestStream, false);
    }
    zipWriter.close();

    AddonManager.addInstallListener(installListener);
    AddonManager.getInstallForFile(tmpFile, (install) => {
      let webInstaller = Cc["@mozilla.org/addons/web-install-listener;1"].getService(Ci.amIWebInstallListener);
      let browser = win.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDocShell).chromeEventHandler;
      webInstaller.onWebInstallRequested(browser, win.document.documentURIObject, [install], 1);
    });
  } catch(e) {
    Cu.reportError(e);
    clearTemp();
  }
}

var moonttoolObserver = {
  observe: function(subject, topic, data) {
    if (data == "Run") {
      main(subject);
    }
  }
};

function startup(data, reason) {
  Services.obs.addObserver(moonttoolObserver, "moonttoolEvent", false);
}

function shutdown(data, reason) {
  if (reason == APP_SHUTDOWN) return;
  Services.obs.removeObserver(moonttoolObserver, "moonttoolEvent");
  AddonManager.removeInstallListener(installListener);
}

function install() {};
function uninstall() {};
