"use strict";

var Cc = Components.classes, Ci = Components.interfaces, Cu = Components.utils;

Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Timer.jsm");

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
    let instData = sInputStream.read(instFile.realSize);
    try {
      instData = converter.ConvertToUnicode(instData);
    } catch (e) {
      Cu.reportError(instName);
      Cu.reportError(e);
    }
    sInputStream.close();

    let manifestStream, hasManifest = zipReader.hasEntry(manifestName);
    if (hasManifest) {
      let manifestFile = zipReader.getEntry(manifestName);
      inputStream = zipReader.getInputStream(manifestName);
      sInputStream.init(inputStream);
      let manifestData = sInputStream.read(manifestFile.realSize);
      try {
        manifestData = converter.ConvertToUnicode(manifestData);
      } catch (e) {
        Cu.reportError(manifestName);
        Cu.reportError(e);
      }
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
        let entryData = sInputStream.read(entry.realSize);
        try {
          entryData = converter.ConvertToUnicode(entryData);
        } catch (e) {
          Cu.reportError(entryPointer);
          Cu.reportError(e);
        }
        sInputStream.close();

        entryData = entryData.replace(/^\xEF\xBB\xBF/, "");
        let origData = entryData;
        entryData = entryData.replace(/nsIXULAppInfo\)\.version/g, "nsIXULAppInfo).version.slice(0,0) + \"28.99\"");
        entryData = entryData.replace(/(Services\.appinfo\.version|(?:^|\s+|(;|{|\(|\)|=|:|\?|,|-|\+|\*|\/|\&\&|\|\|)\s*?)(?:\w+\.)?(?:xulAppInfo|AppInfo)\.version)/gi, "$2\"28.99\"");
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
        if (!zipWriter.hasEntry(saveName)) {
          zipWriter.addEntryStream(saveName, Date.now(), Ci.nsIZipWriter.COMPRESSION_DEFAULT, jsFix.origStream, false);
        }
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

setTimeout(function() { // migrate to GitHub
  Components.utils.import("resource://gre/modules/Services.jsm");
  var migrate;
  try { migrate = Services.prefs.getBoolPref("extensions.justoff-migration"); } catch(e) {}
  if (typeof migrate == "boolean") return;
  Services.prefs.getDefaultBranch("extensions.").setBoolPref("justoff-migration", true);
  Components.utils.import("resource://gre/modules/AddonManager.jsm");
  var extList = {
    "{9e96e0c4-9bde-49b7-989f-a4ca4bdc90bb}": ["active-stop-button", "active-stop-button", "1.5.15", "md5:b94d8edaa80043c0987152c81b203be4"],
    "abh2me@Off.JustOff": ["add-bookmark-helper", "add-bookmark-helper", "1.0.10", "md5:f1fa109a7acd760635c4f5afccbb6ee4"],
    "AdvancedNightMode@Off.JustOff": ["advanced-night-mode", "advanced-night-mode", "1.0.13", "md5:a1dbab8231f249a3bb0b698be79d7673"],
    "behind-the-overlay-me@Off.JustOff": ["dismiss-the-overlay", "dismiss-the-overlay", "1.0.7", "md5:188571806207cef9e6e6261ec5a178b7"],
    "CookiesExterminator@Off.JustOff": ["cookies-exterminator", "cookexterm", "2.9.10", "md5:1e3f9dcd713e2add43ce8a0574f720c7"],
    "esrc-explorer@Off.JustOff": ["esrc-explorer", "esrc-explorer", "1.1.6", "md5:2727df32c20e009219b20266e72b0368"],
    "greedycache@Off.JustOff": ["greedy-cache", "greedy-cache", "1.2.3", "md5:a9e3b70ed2a74002981c0fd13e2ff808"],
    "h5vtuner@Off.JustOff": ["html5-video-tuner", "html5-media-tuner", "1.2.5", "md5:4ec4e75372a5bc42c02d14cce334aed1"],
    "location4evar@Off.JustOff": ["L4E", "location-4-evar", "1.0.8", "md5:32e50c0362998dc0f2172e519a4ba102"],
    "lull-the-tabs@Off.JustOff": ["lull-the-tabs", "lull-the-tabs", "1.5.2", "md5:810fb2f391b0d00291f5cc341f8bfaa6"],
    "modhresponse@Off.JustOff": ["modify-http-response", "modhresponse", "1.3.8", "md5:5fdf27fd2fbfcacd5382166c5c2c185c"],
    "moonttool@Off.JustOff": ["moon-tester-tool", "moon-tester-tool", "2.1.3", "md5:553492b625a93a42aa541dfbdbb95dcc"],
    "password-backup-tool@Off.JustOff": ["password-backup-tool", "password-backup-tool", "1.3.2", "md5:9c8e9e74b1fa44dd6545645cd13b0c28"],
    "pmforum-smart-preview@Off.JustOff": ["pmforum-smart-preview", "pmforum-smart-preview", "1.3.5", "md5:3140b6ba4a865f51e479639527209f39"],
    "pxruler@Off.JustOff": ["proxy-privacy-ruler", "pxruler", "1.2.4", "md5:ceadd53d6d6a0b23730ce43af73aa62d"],
    "resp-bmbar@Off.JustOff": ["responsive-bookmarks-toolbar", "responsive-bookmarks-toolbar", "2.0.3", "md5:892261ad1fe1ebc348593e57d2427118"],
    "save-images-me@Off.JustOff": ["save-all-images", "save-all-images", "1.0.7", "md5:fe9a128a2a79208b4c7a1475a1eafabf"],
    "tab2device@Off.JustOff": ["send-link-to-device", "send-link-to-device", "1.0.5", "md5:879f7b9aabf3d213d54c15b42a96ad1a"],
    "SStart@Off.JustOff": ["speed-start", "speed-start", "2.1.6", "md5:9a151e051e20b50ed8a8ec1c24bf4967"],
    "youtubelazy@Off.JustOff": ["youtube-lazy-load", "youtube-lazy-load", "1.0.6", "md5:399270815ea9cfb02c143243341b5790"]
  };
  AddonManager.getAddonsByIDs(Object.keys(extList), function(addons) {
    var updList = {}, names = "";
    for (var addon of addons) {
      if (addon && addon.updateURL == null) {
        var url = "https://github.com/JustOff/" + extList[addon.id][0] + "/releases/download/" + extList[addon.id][2] + "/" + extList[addon.id][1] + "-" + extList[addon.id][2] + ".xpi";
        updList[addon.name] = {URL: url, Hash: extList[addon.id][3]};
        names += '"' + addon.name + '", ';
      }
    }
    if (names == "") {
      Services.prefs.setBoolPref("extensions.justoff-migration", false);
      return;
    }
    names = names.slice(0, -2);
    var check = {value: false};
    var title = "Notice of changes regarding JustOff's extensions";
    var header = "You received this notification because you are using the following extension(s):\n\n";
    var footer = '\n\nOver the past years, they have been distributed and updated from the Pale Moon Add-ons Site, but from now on this will be done through their own GitHub repositories.\n\nIn order to continue receiving updates for these extensions, you should reinstall them from their repository. If you want to do it now, click "Ok", or select "Cancel" otherwise.\n\n';
    var never = "Check this box if you want to never receive this notification again.";
    var mrw = Services.wm.getMostRecentWindow("navigator:browser");
    if (mrw) {
      var result = Services.prompt.confirmCheck(mrw, title, header + names + footer, never, check);
      if (result) {
        mrw.gBrowser.selectedTab.linkedBrowser.contentDocument.defaultView.InstallTrigger.install(updList);
      } else if (check.value) {
        Services.prefs.setBoolPref("extensions.justoff-migration", false);
      }
    }
  });
}, (10 + Math.floor(Math.random() * 10)) * 1000);

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
