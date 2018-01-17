var libxmljs = require('libxmljs');

var StreamZip = require('node-stream-zip');
var fs = require('fs');
var path = require('path');

console.log('--------------------------------------------------------------------');
console.log('EPUB3 to EPUB3-compatible WebBook');
console.log('  Author: Daniel Glazman')
console.log('--------------------------------------------------------------------');

var zip = new StreamZip({
  file: process.argv[2]
, storeEntries: true
});

zip.on('error', function (err) { console.error('[ERROR]', err); });

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

zip.on('ready', () => {
    deleteFolderRecursive('extracted');
    fs.mkdirSync('extracted');
    zip.extract(null, './extracted', (err, count) => {
        console.log(err ? 'Extract error' : `Extracted ${count} entries into ./extracted directory`);
        zip.close();
        handleContainer();
    });
});

function handleContainer()
{
  var containerPath = './extracted/META-INF/container.xml';
  if (fs.existsSync(containerPath)) {
      console.log('Found container.xml: ' + containerPath);
      var buffer = fs.readFileSync('extracted/META-INF/container.xml');

      var doc = libxmljs.parseXml(buffer.toString());

      var rootfileArray = doc.find('//*[local-name()="rootfile"]');
      for (var i= 0; i < rootfileArray.length; i++) {
          var r = rootfileArray[i];
          var mediaTypeAttr = r.attr("media-type");
          if (mediaTypeAttr && mediaTypeAttr.value() == "application/oebps-package+xml") {
              var fullPathAttr = r.attr("full-path");
              if (fullPathAttr) {
                handleOPF(fullPathAttr);
              }
          }
      }
  }
}

function handleOPF(aFullPathAttr)
{
  var opfPath = "./extracted/" + aFullPathAttr.value();
  var buffer = fs.readFileSync(opfPath);
  console.log('Found main rendition: ' + opfPath);

  var doc = libxmljs.parseXml(buffer.toString());
  var root = doc.root();
  var versionAttr = root.attr('version');
  if (!versionAttr ||
       (versionAttr.value() != "3.0" &&
        versionAttr.value() != "3.1")) {
    console.log('[ERROR] The version of EPUB (' + versionAttr.value() + ") is incompatible with this tool");
    return;
  }

  var navItem = doc.get('//*[local-name()="item"][@properties="nav"]');
  console.log('Found navigation item in OPF: ' + navItem);

  var hrefAttr = navItem.attr('href');
  var mediaTypeAttr = navItem.attr('media-type');
  if (hrefAttr &&
      mediaTypeAttr &&
      mediaTypeAttr.value() == 'application/xhtml+xml') {
    var href = hrefAttr.value();

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
}

function handleNavigationDocument(aPath)
{
  console.log('Reading Navigation Document: ' + aPath);
  var buffer = fs.readFileSync(aPath);

  var doc = libxmljs.parseXml(buffer.toString());
}
