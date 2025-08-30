const { batchUpload } = require('./uploader');

async function main() {
  const videoDir = './videos';  // 可通过 commander 解析命令行参数
  await batchUpload(videoDir);
  console.log('Batch upload completed.');
}

main();
