const ProgressBar = require('progress');

function createProgressBar(fileName, totalSize) {
  return new ProgressBar(`Uploading ${fileName} [:bar] :percent :etas`, {
    complete: '=',
    incomplete: ' ',
    width: 20,
    total: totalSize,
  });
}

module.exports = { createProgressBar };
