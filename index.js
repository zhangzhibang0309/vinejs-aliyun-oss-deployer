const fs = require('fs');
const util = require('util');
const exists = util.promisify(fs.exists);
const _yaml = require('js-yaml');
const log = require('./utils/colorLog.js');
const path = require('path');
const oss = require('ali-oss');
const ora = require('ora');
let client; // oss client object
const commonPath = 'dist';

const getYaml = (dir) => {
  return new Promise((resolve, reject) => {
    let yamlData = {};
    try {
      yamlData = _yaml.load(fs.readFileSync(dir, 'utf-8'));
    } catch (e) {
      reject(e);
    } finally {
      resolve(yamlData);
    }
  });
}

const uploadDir = (client, path, headers) => {
  let fileURL = null;
  fs.readdirSync(path).forEach(async data => {
    fileURL = `${path}/${data}`;
    if (fs.statSync(fileURL).isDirectory()) {
      uploadDir(client, fileURL, headers);
    } else {
      log.info(`upload file ${fileURL}`);
      await client.put(fileURL, path.normalize(fileURL), headers);
    }
  })
}

const uploadProcess = ora('upload dist folder to your OSS bucket...\n');

/*
0. 校验vine.deployer.yml是否合法，如合法则解析
1. 判断是否有dist
2. 尝试开启oss对象调用
3. 遍历并上传文件
*/
function publish() {
  return getYaml(path.resolve(process.cwd(), 'deployer/vine.deployer.yml'))
  .then(res => {
    if (res.type !== 'aliyun-oss') {
      log.error(`Deployer type invalid, please check your config.`);
      process.exit(1);
    }
    if (!(
      res.auth.region &&
      res.auth.accessKeyId &&
      res.auth.accessKeySecret &&
      res.auth.bucket
      )) {
      log.error('You should configure deployer settings in vine.deployer.yml first, see this example:');
      console.log(
        `        type: aliyun-oss
        auth:
          region: <your oss region>
          accessKeyId: <your access key id>
          accessKeySecret: <your access key secret>
          bucket: <your aliyun oss bucket name>
          path: [upload path]
      `)
      process.exit(1);
    }
    if (res.path && res.path[res.path.length - 1] !== '/') {
      log.error(`Upload path must end with '/', got ${res.path}, required ${res.path + '/'}.`);
      process.exit(1);
    }
    client = new oss({
      region: res.auth.region,
      accessKeyId: res.auth.accessKeyId,
      accessKeySecret: res.auth.accessKeySecret,
      bucket: res.auth.bucket
    });
    return res;
  })
  .catch(err => {
    // yaml file error
    log.error('Oops, something wrong in deployer.');
    log.error(err);
    log.error(`vine.deployer.yml not found in deployer path, please check your config.`);
    process.exit(1);
  })
  .then(() => {
    return exists(path.resolve( commonPath));
  })
  .then(res => {
    // if 'dist' don't exist
    if (!res) {
      log.error(`cannot find path 'dist', did you forget to build this project?`);
      log.error(`try run command 'vine build' first.`);
      process.exit(1);
    }
    return exists(path.resolve(commonPath, '.git'));
  })
  .then(res => {
    const headers = res.upload_headers;
    uploadProcess.start();
    return uploadDir(client, path.resolve(process.cwd(), 'dist'), headers);
  })
  .then(() => {
    uploadProcess.succeed();
    log.info('upload successful.');
  })
  .catch(err => {
    uploadProcess.fail();
    console.log(err);
    log.error('Oops, something wrong in deployer.');
    process.exit(1);
  })
}

module.exports = publish;