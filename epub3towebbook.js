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
        if (!err)
          handleContainer();
    });
});

// Where we deal with the container.xml file
function handleContainer()
{
  // its path is always the same
  var containerPath = './extracted/META-INF/container.xml';

  if (fs.existsSync(containerPath)) {
      console.log('Found container.xml: ' + containerPath);

      // read the contents of the file
      var buffer = fs.readFileSync('extracted/META-INF/container.xml');

      // parse it
      var doc = libxmljs.parseXml(buffer.toString());

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
                handleOPF(fullPathAttr);

                // we're done here
                return;
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
  console.log('Found main rendition: ' + opfPath);

  // parse it
  var doc = libxmljs.parseXml(buffer.toString());

  // verify it's a 3.x EPUB package
  var root = doc.root();
  var versionAttr = root.attr('version');
  if (!versionAttr ||
       (versionAttr.value() != "3.0" &&
        versionAttr.value() != "3.1")) {
    console.log('[ERROR] The version of EPUB (' + versionAttr.value() + ") is incompatible with this tool");
    return;
  }

  // get the item referencing the Navigation Document
  var navItem = doc.get('//*[local-name()="item"][@properties="nav"]');
  if (!navItem) {
    console.log('[ERROR] No navigation document, nothing we can do now');
    // TODO create a navigation document from the OPF and other metadata
    return;
  }
  console.log('Found navigation item in OPF: ' + navItem);

  // do we have the right type of file?
  var hrefAttr = navItem.attr('href');
  var mediaTypeAttr = navItem.attr('media-type');
  if (hrefAttr &&
      mediaTypeAttr &&
      mediaTypeAttr.value() == 'application/xhtml+xml') {
    var href = hrefAttr.value();

    // Early way out if there is nothing to do...
    var finalNavPath = path.relative(path.dirname(opfPath), "./extracted/index.xhtml");
    if (finalNavPath == href) {
      console.log('[WARNING] Nothing to do, package already has a index.xhtml file in topmost directory');
      return;
    }

    if (href[0] != ".") // sanity check for path.resolve()
      href = "./" + href;
    handleNavigationDocument(path.resolve(path.dirname(opfPath), href));

    // change the path in OPF
    console.log('Changing navigation item to target file ' + finalNavPath);
    hrefAttr.value(finalNavPath);
  }
  else {
    console.log("[ERROR] The Navigation Document is not a XHTML document!");
    return;
  }
}

// Where we deal with the Navigation Document
function handleNavigationDocument(aPath)
{
  console.log('Reading Navigation Document: ' + aPath);
  var buffer = fs.readFileSync(aPath);

  var doc = libxmljs.parseXml(buffer.toString());
}
