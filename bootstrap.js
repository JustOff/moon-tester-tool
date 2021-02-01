"use strict";

var Cc = Components.classes, Ci = Components.interfaces, Cu = Components.utils;

Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

const branch = "extensions.moonttool.";
const pr = {PR_RDONLY: 0x01, PR_WRONLY: 0x02, PR_RDWR: 0x04, PR_CREATE_FILE: 0x08, PR_APPEND: 0x10, PR_TRUNCATE: 0x20};
const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

var tempDir;

var locale = {
  get: function(key) {
    if (!this.bundle) {
      this.bundle = Services.strings.createBundle("chrome://moonttool/locale/moonttool.properties");
    }
    return this.bundle.GetStringFromName(key);
  }
};

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
};

function patchAndInstall(win, srcFile) {
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
      win.alert(locale.get("invalid"));
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
    let instData = converter.ConvertToUnicode(sInputStream.read(instFile.realSize));
    sInputStream.close();

    let manifestStream, hasManifest = zipReader.hasEntry(manifestName);
    if (hasManifest) {
      let manifestFile = zipReader.getEntry(manifestName);
      inputStream = zipReader.getInputStream(manifestName);
      sInputStream.init(inputStream);
      let manifestData = converter.ConvertToUnicode(sInputStream.read(manifestFile.realSize));
      sInputStream.close();

      manifestData = manifestData.replace(/^\xEF\xBB\xBF/, "");
      let origManifest = manifestData;
      manifestData = manifestData.replace(/\{ec8030f7\-c20a\-464f\-9b0e\-13a3a9e97384\}/gi, "{8de7fcbb-c55c-4fbe-bfc5-fc555c87dbc4}");
      manifestData = manifestData.replace(/appversion<(=28|29)/gi, "appversion<99");
      manifestData = manifestData.replace(/appversion>(28|=29)/gi, "appversion>99");
      if (manifestData != origManifest) {
        manifestData += "\n\n# Original data:\n#\n# " + origManifest.split(/\r?\n/).join("\n# ");
      }

      manifestStream = converter.convertToInputStream(manifestData);
    }

    let jsFixArray = [];
    let entries = zipReader.findEntries('*.(js|JS|jsm|JSM)$');
    while (entries.hasMore()) {
      let entryPointer = entries.getNext();
      let entry = zipReader.getEntry(entryPointer);
      if (!entry.isDirectory) {
        inputStream = zipReader.getInputStream(entryPointer);
        sInputStream.init(inputStream);
        let entryData = converter.ConvertToUnicode(sInputStream.read(entry.realSize));
        sInputStream.close();

        entryData = entryData.replace(/^\xEF\xBB\xBF/, "");
        let origData = entryData;
        entryData = entryData.replace(/nsIXULAppInfo\)\.version/g, "nsIXULAppInfo).version.slice(0,0) + \"28.99\"");
        entryData = entryData.replace(/(Services\.appinfo\.version|xulAppInfo\.version|AppInfo\.version)/gi, "\"28.99\"");
        if (entryData != origData) {
          jsFixArray.push({name: entryPointer,
                           stream: converter.convertToInputStream(entryData),
                           origStream: converter.convertToInputStream(origData)});
        }
      }
    }
    zipReader.close();

    instData = instData.replace(/^\xEF\xBB\xBF/, "");
    let origInst = instData;
    instData = instData.replace(/<(em:)?name>/ig, "<$1name>[TEST] ");
    instData = instData.replace(/(em:)?name\s*=\s*"/ig, '$1name="[TEST] ');
    instData = instData.replace(/<em:targetApplication>[\s\S]+?<\/em:targetApplication>/i, "%compatDataA%");
    instData = instData.replace(/<em:targetApplication\s+RDF:resource[\s\S]+?\/>/i, "%compatDataA%");
    instData = instData.replace(/<em:targetApplication\s+RDF:resource[\s\S]+?\/>/ig, "");
    instData = instData.replace(/<targetApplication>[\s\S]+?<\/targetApplication>/i, "%compatDataB%");
    instData = instData.replace(/<(em:)?targetApplication>[\s\S]+?<\/(em:)?targetApplication>/ig, "");
    instData = instData.replace(/<(em:)?updateURL>[\s\S]+?<\/(em:)?updateURL>/i, "");
    instData = instData.replace(/(em:)?updateURL\s*=\s*".+?"/i, "");
    let compatData = "<em:targetApplication><Description><em:id>{8de7fcbb-c55c-4fbe-bfc5-fc555c87dbc4}</em:id><em:minVersion>27.0.0a1</em:minVersion><em:maxVersion>*</em:maxVersion></Description></em:targetApplication><em:updateURL>https://localhost/update.xml</em:updateURL>";
    instData = instData.replace("%compatDataA%", compatData);
    compatData = compatData.replace(/em:/gi, "");
    instData = instData.replace("%compatDataB%", compatData);
    instData += "\n\n<?original data:\n" + origInst.replace(/<\?.+?\?>/g,"") +
      "\nThis Add-on has been modified by Moon Tester Tool - https://github.com/JustOff/moon-tester-tool\n\n?>";

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
    if (hasManifest) {
      zipWriter.removeEntry(manifestName, false);
      zipWriter.addEntryStream(manifestName, Date.now(), Ci.nsIZipWriter.COMPRESSION_DEFAULT, manifestStream, false);
    }
    if (jsFixArray.length && Services.prompt.confirm(win, locale.get("jsfix.title"), locale.get("jsfix.text"))) {
      for (let jsFix of jsFixArray) {
        zipWriter.removeEntry(jsFix.name, false);
        zipWriter.addEntryStream(jsFix.name, Date.now(), Ci.nsIZipWriter.COMPRESSION_DEFAULT, jsFix.stream, false);
        let saveName = jsFix.name + ".mtt";
        if (zipWriter.hasEntry(saveName)) {
          zipWriter.removeEntry(saveName, false);
        }
        zipWriter.addEntryStream(saveName, Date.now(), Ci.nsIZipWriter.COMPRESSION_DEFAULT, jsFix.origStream, false);
      }
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

function checkDiscalimer(win) {
  if (Services.prefs.getBranch(branch).getBoolPref("disclaimer")) {
    return true;
  } else {
    let check = {value: false};
    Services.prompt.alertCheck(win, locale.get("disclaimer.title"), 
      locale.get("disclaimer.text"), locale.get("disclaimer.message"), check);
    if (check.value) {
      Services.prefs.getBranch(branch).setBoolPref("disclaimer", true);
    }
    return check.value;
  }
}

function installTestAddon(win) {
  if (!checkDiscalimer(win)) { return; }
  let filePicker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
  filePicker.init(win, locale.get("load"), Ci.nsIFilePicker.modeOpen); 
  try {
    filePicker.appendFilter("Add-ons", "*.xpi");
    filePicker.appendFilters(Ci.nsIFilePicker.filterAll);
  } catch(e) {}

  if (filePicker.show() == Ci.nsIFilePicker.returnOK) {
    patchAndInstall(win, filePicker.file);
  }
}

function showButtons(subject) {
  let doc = subject.document || this;
  if (doc.getElementById("view-port").selectedPanel.id == "list-view") {
    let button, item, controlContainer;
    for (let i = 0; i < doc.getElementById("addon-list").itemCount; i++) {
      item = doc.getElementById("addon-list").getItemAtIndex(i);
      controlContainer = doc.getAnonymousElementByAttribute(item, "anonid", "control-container");
      if (controlContainer && item.getAttribute("type") == "extension" && !item.hasAttribute("mtt-test") &&
          (item.getAttribute("native") == "false" || item.mAddon.isCompatible == false)) {
        button = doc.createElementNS(XUL_NS, "button");
        button.setAttribute("label", locale.get("test.label"));
        button.setAttribute("tooltiptext", locale.get("test.tooltip"));
        button.setAttribute("class", "addon-control mtt-test");
        button.setAttribute("extid", item.value);
        button.setAttribute("oncommand", "Services.obs.notifyObservers(window, 'moonttoolEvent', 'Test::' + this.getAttribute('extid'));");
        controlContainer.insertBefore(button, controlContainer.firstChild);
        item.setAttribute("mtt-test", "true");
      }
    }
  }
}

function onLoadAM() {
  this.removeEventListener("load", onLoadAM, false);
  this.addEventListener("unload", onUnloadAM, false);
  this.document.addEventListener("ViewChanged", showButtons, false);
  showButtons(this);
  let menu = this.document.getElementById("addonitem-popup");
  menu.addEventListener("popupshowing", () => {
    let selectedItem = this.document.getElementById("addon-list").selectedItem;
    if (selectedItem) {
      let addon = selectedItem.mAddon;
      let separator = this.document.getElementById("menuseparator_saveXPI");
      let item = this.document.getElementById("menuitem_saveXPI");
      if (addon.type == "extension" || addon.type == "theme" ||
          addon.type == "dictionary" || addon.type == "locale") {
        separator.removeAttribute("style");
        item.setAttribute("disabled", "false");
        item.setAttribute("extid", addon.id);
      } else {
        separator.setAttribute("style", "display: none");
        item.setAttribute("disabled", "true");
        item.removeAttribute("extid");
      }
    }
  }, false);
  let separator = this.document.createElementNS(XUL_NS, "menuseparator");
  separator.setAttribute("id", "menuseparator_saveXPI");
  menu.appendChild(separator);
  let item = this.document.createElementNS(XUL_NS, "menuitem");
  item.setAttribute("id", "menuitem_saveXPI");
  item.setAttribute("label", locale.get("save"));
  item.setAttribute("oncommand", "Services.obs.notifyObservers(window, 'moonttoolEvent', 'Save::' + this.getAttribute('extid'));");
  menu.appendChild(item);
  let umenu = this.document.getElementById("utils-menu");
  let useparator = this.document.createElementNS(XUL_NS, "menuseparator");
  umenu.append(useparator);
  let uitem = this.document.createElementNS(XUL_NS, "menuitem");
  uitem.setAttribute("id", "utils-save-menuitem");
  uitem.setAttribute("label", locale.get("install"));
  uitem.setAttribute("oncommand", "Services.obs.notifyObservers(window, 'moonttoolEvent', 'Run');");
  umenu.append(uitem);
}

function onUnloadAM() {
  this.removeEventListener("unload", onUnloadAM, false);
  this.document.removeEventListener("ViewChanged", showButtons, false);
}

var chromeObserver = {
  observe: function chromeObserver(subject, topic, data) {
    if (topic == "chrome-document-global-created" &&
        subject.document && subject.document.documentURI &&
        subject.document.documentURI == "about:addons") {
      subject.addEventListener("load", onLoadAM, false);
    }
  }
};

function zipFolder(zipWriter, dstFilePath, dir, relPath) {
  let entries = dir.directoryEntries;
  while (entries.hasMoreElements()) {
    let entry = entries.getNext().QueryInterface(Ci.nsIFile);
    if (entry.path == dstFilePath || entry.leafName == ".git") { continue; }
    zipWriter.addEntryFile(relPath + entry.leafName, Ci.nsIZipWriter.COMPRESSION_DEFAULT, entry, false);
    if (entry.isDirectory()) {
      zipFolder(zipWriter, dstFilePath, entry, relPath + entry.leafName + "/");
    }
  }
}

var moonttoolObserver = {
  observe: function(subject, topic, data) {
    if (data == "Run") {
      installTestAddon(subject);
    } else if (data.substring(4, 6) == "::") {
      AddonManager.getAddonByID(data.substring(6), (addon) => {
        if (addon == null) { return; }
        if (addon.name.startsWith("[TEST]")) {
          let check = {value: false};
          Services.prompt.alertCheck(subject, locale.get("warning.title"), 
            locale.get("warning.text"), locale.get("warning.message"), check);
          if (!check.value) { return; }
        }
        let srcFile = addon.getResourceURI().QueryInterface(Ci.nsIFileURL).file;
        let filePicker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
        let bundle = Services.strings.createBundle("chrome://mozapps/locale/downloads/unknownContentType.properties");
        filePicker.init(subject, bundle.GetStringFromName("saveDialogTitle"), Ci.nsIFilePicker.modeSave);
        filePicker.appendFilter("XPInstall Install", "*.xpi");
        filePicker.defaultString = addon.name.replace(/\s/g, "-") + "-" + addon.version + ".xpi";
        filePicker.defaultExtension = "xpi";
        if (filePicker.show() != Ci.nsIFilePicker.returnCancel) {
          let dstFile = filePicker.file;
          if (dstFile.exists()) { dstFile.remove(false); }
          if (srcFile.isDirectory()) {
            let zipWriter = Cc["@mozilla.org/zipwriter;1"].createInstance(Ci.nsIZipWriter);
            zipWriter.open(dstFile, pr.PR_RDWR | pr.PR_CREATE_FILE);
            zipFolder(zipWriter, dstFile.path, srcFile, "");
            zipWriter.close();
          } else {
            srcFile.copyTo(dstFile.parent, dstFile.leafName);
          }
          if (data.substring(0, 4) == "Test") {
            if (checkDiscalimer(subject)) {
              patchAndInstall(subject, dstFile);
            }
          }
        }
      });
    }
  }
};

function reloadAMs() {
  let winenu = Services.wm.getEnumerator("navigator:browser");
  while (winenu.hasMoreElements()) {
    winenu.getNext().gBrowser.browsers.forEach((browser) => {
      if (browser.currentURI.spec == "about:addons") {
        try {
          browser.contentWindow.location.reload();
        } catch(e) {}
      }
    });
  }
}

function startup(data, reason) {
  Services.prefs.getDefaultBranch(branch).setBoolPref("disclaimer", false);
  Services.obs.addObserver(moonttoolObserver, "moonttoolEvent", false);
  Services.obs.addObserver(chromeObserver, "chrome-document-global-created", false);
  if (reason != APP_STARTUP) {
    reloadAMs();
  }
}

function shutdown(data, reason) {
  if (reason == APP_SHUTDOWN) return;
  Services.obs.removeObserver(chromeObserver, "chrome-document-global-created");
  Services.obs.removeObserver(moonttoolObserver, "moonttoolEvent");
  AddonManager.removeInstallListener(installListener);
  reloadAMs();
}

function install() {};
function uninstall() {};
