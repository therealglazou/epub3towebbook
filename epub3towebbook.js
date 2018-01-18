/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/
 *
 * Copyright (C) 2018, Disruptive Innovations SAS.
 *
 * epub3towebbook, a Node module to transform a EPUB3 package into a EPUB3-compatible
 * WebBook.
*/
// We need libxmljs to parse, read and re-serialize XML and XHTML documents
var libxmljs = require('libxmljs');

// we need node-stream-zip, well, to unzip the EPUB
var StreamZip = require('node-stream-zip');

// General Node stuff we can't do without 
var fs = require('fs');
var path = require('path');

console.log('--------------------------------------------------------------------');
console.log('EPUB3 to EPUB3-compatible WebBook');
console.log('  Author: Daniel Glazman')
console.log('--------------------------------------------------------------------');

// The path to the EPUB package to modify is given as argument on the command-line
// Typical usage:
//     node epub3towebbook.js ./mybook.epub
var zip = new StreamZip({
  file: process.argv[2]
, storeEntries: true
});

// just in case we can't access or unzip the file
zip.on('error', function (err) { console.error('[ERROR]', err); });

// Utility function to get rid of a directory that's not necessarily
// empty; it's amazing that fd.rmdir() does not accept a depth argument...
var deleteFolderRecursive = function(path) {
    if (fs.existsSync(path)) {
        fs.readdirSync(path).forEach(function(file, index){
                var curPath = path + "/" + file;
                if (fs.lstatSync(curPath).isDirectory()) { // recurse
                    deleteFolderRecursive(curPath);
                } else { // delete file
                    fs.unlinkSync(curPath);
                }
            });
        fs.rmdirSync(path);
    }
};

// Our zip is ready to be extracted
zip.on('ready', () => {
    // Make sure we don't already have an extraction directory or node-stream-zip will choke
    deleteFolderRecursive('extracted');

    // recreate the directory
    fs.mkdirSync('extracted');

    // let's dance, baby
    zip.extract(null, './extracted', (err, count) => {
        console.log(err ? 'Extract error' : `Extracted ${count} entries into ./extracted directory`);
        zip.close();

        // Without error, let's move to next step
        if (!err) {
          var oldNavPath = path.relative(__dirname + "/extracted", handleContainer());

          // now we need to zip again...
          var fileName = process.argv[2];
          var periodIndex = fileName.lastIndexOf('.');
          var newFileName = fileName.substr(0, periodIndex)
                            + '-webbook'
                            + fileName.substr(periodIndex);

          var zipper = new require('node-zip')();
          zipper.file("mimetype", fs.readFileSync(path.join(__dirname, 'extracted/mimetype')));
          var entries = zip.entries();
          for (i in entries) {
            var entry = entries[i];
            var name = entry.name;
            if (name != "mimetype") {
              if (name != oldNavPath)
                zipper.file(name, fs.readFileSync(path.join(__dirname, 'extracted/' + name)));
            }
          }
          zipper.file("index.xhtml", fs.readFileSync(path.join(__dirname, 'extracted/index.xhtml')));

          var data = zipper.generate({ base64:false });
          fs.writeFileSync(newFileName, data, 'binary');

          console.log('--------------------------------------------------------------------');
          console.log('WebBook saved under name: ' + newFileName);
        }
    });
});

// Where we deal with the container.xml file
function handleContainer()
{
  // its path is always the same
  var containerPath = './extracted/META-INF/container.xml';

  if (fs.existsSync(containerPath)) {
      console.log('Reading container.xml: ' + './extracted/META-INF/container.xml');

      // read the contents of the file
      var buffer = fs.readFileSync('extracted/META-INF/container.xml');

      // parse it
      var doc = null;
      try {
        doc = libxmljs.parseXml(buffer.toString());
      }
      catch(e) {
        console.log("  [ERROR] Cannot parse XML file " + containerPath);
        return;
      }

      // get all rootfile elements
      var rootfileArray = doc.find('//*[local-name()="rootfile"]');

      // and browse them...
      for (var i= 0; i < rootfileArray.length; i++) {
          var r = rootfileArray[i];
          var mediaTypeAttr = r.attr("media-type");
          // to find the first reference to a OPF file
          if (mediaTypeAttr && mediaTypeAttr.value() == "application/oebps-package+xml") {
              var fullPathAttr = r.attr("full-path");
              if (fullPathAttr) {
                console.log('  Found main rendition: ' + fullPathAttr);
                return handleOPF(fullPathAttr);
              }
          }
      }
  }
}

// Where we deal with the OPF file
function handleOPF(aFullPathAttr)
{
  var opfPath = "./extracted/" + aFullPathAttr.value();

  // read the contents of the file
  var buffer = fs.readFileSync(opfPath);
  console.log('Reading OPF file: ' + opfPath);

  // parse it
  var doc = null;
  try {
    doc = libxmljs.parseXml(buffer.toString());
  }
  catch(e) {
    console.log("  [ERROR] Cannot parse XML file " + opfPath);
    return null;
  }


  // verify it's a 3.x EPUB package
  var root = doc.root();
  var versionAttr = root.attr('version');
  if (!versionAttr ||
       (versionAttr.value() != "3.0" &&
        versionAttr.value() != "3.1")) {
    console.log('  [ERROR] The version of EPUB (' + versionAttr.value() + ") is incompatible with this tool");
    return null;
  }

  // get the item referencing the Navigation Document
  var navItem = doc.get('//*[local-name()="item"][@properties="nav"]');
  if (!navItem) {
    console.log('  [ERROR] No navigation document, nothing we can do now');
    // TODO create a navigation document from the OPF and other metadata
    return null;
  }
  console.log('  Found navigation item in OPF:');
  console.log('    ' + navItem);

  // do we have the right type of file?
  var hrefAttr = navItem.attr('href');
  var mediaTypeAttr = navItem.attr('media-type');
  if (hrefAttr &&
      mediaTypeAttr &&
      mediaTypeAttr.value() == 'application/xhtml+xml') {
    var href = hrefAttr.value();

    // Early way out if there is nothing to do...
    var finalNavPath = path.resolve(path.dirname(opfPath), "./extracted/index.xhtml");
    if (finalNavPath == href) {
      console.log('  [WARNING] Nothing to do, package already has a index.xhtml file in topmost directory');
      return null;
    }

    if (href[0] != ".") // sanity check for path.resolve()
      href = "./" + href;

    var relPath = path.resolve(opfPath, __dirname + "/extracted/index.xhtml");

    // change the path in OPF
    finalNavPath = path.relative(path.dirname(opfPath), relPath);
    console.log('  Changing navigation item to target file ' + finalNavPath);
    hrefAttr.value(finalNavPath);

    // refreshing the opf file
    buffer = doc.toString();
    fs.writeFileSync(opfPath, buffer.toString());
    console.log('  OPF Document modified and saved.');

    handleNavigationDocument(opfPath, path.resolve(path.dirname(opfPath), href), relPath);
    // fix all the other documents just in case...
    var otherItems = doc.find('//*[local-name()="item"][@media-type="application/xhtml+xml"]');
    for (var i = 0; i < otherItems.length; i++) {
      var item = otherItems[i];
      if (!item.attr("properties") || item.attr("properties").value() != "nav")
        handleContentDocument(opfPath, otherItems[i].attr("href").value(), path.resolve(path.dirname(opfPath), href), relPath);
    }

    return path.resolve(path.dirname(opfPath), href);
  }
  else {
    console.log("  [ERROR] The Navigation Document is not a XHTML document!");
    return null;
  }
}

// Where we deal with the Navigation Document
function handleNavigationDocument(aOpfPath, aPath, aNewPath)
{
  console.log('Reading Navigation Document: ' + aPath);
  var buffer = fs.readFileSync(aPath);

  var doc = null;
  try {
    doc = libxmljs.parseXml(buffer.toString());
  }
  catch(e) {
    console.log("  [ERROR] Cannot parse XML file " + opfPath);
    return;
  }

  var change = path.resolve(aNewPath, aPath);

  console.log("  Fixing hyperlinks in Navigation Document");
  var eltArray = doc.find('//*/@href|//video/@poster|//*/@src');
  eltArray.forEach(function(e) {
    var href = e.value();
    if (href != "#'") { // don't modify local targets...
      var newHref = path.relative(path.dirname(aNewPath), path.resolve(path.dirname(change), href));
      e.value(newHref);
    }
  });

  // now find the toc nav and add the doc-toc role
  var tocNavElement = doc.get("//*[@xmlns:type='toc']", "http://www.idpf.org/2007/ops");
  if (!tocNavElement) {
    console.log("  [ERROR] No toc nav element in Navigation Document!");
    return;
  }
  tocNavElement.attr({"role": "doc-toc"});

  // writing new file
  buffer = doc.toString();
  fs.writeFileSync(aNewPath, buffer.toString());
  console.log('  Navigation Document modified and saved.');
}

function handleContentDocument(aOpfPath, aHref, aPath, aNewPath)
{
  var filePath = path.resolve(path.dirname(aOpfPath), aHref);
  console.log('Reading Content Document: ' + filePath);
  var buffer = fs.readFileSync(filePath);

  var doc = null;
  try {
    doc = libxmljs.parseXml(buffer.toString());
  }
  catch(e) {
    console.log("  [ERROR] Cannot parse XML file " + filePath);
    return;
  }

  var modified = false;

  var eltArray = doc.find('//*/@href|//video/@poster|//*/@src');
  var oldNavFullPath = path.resolve(path.dirname(aOpfPath), aPath)
  eltArray.forEach(function(e) {
    var href = e.value();
    if (path.resolve(path.dirname(path.resolve(path.dirname(aOpfPath), aHref)), href) == oldNavFullPath) {
      console.log("  Updating a hyperlink to Navigation Document: " + href);
      e.value(path.relative(path.dirname(filePath), aNewPath));
      modified = true;
    }
  });

  // writing new file
  if (modified) {
    buffer = doc.toString();
    fs.writeFileSync(filePath, buffer.toString());
    console.log('  Content document modified and saved.');
  }
}
