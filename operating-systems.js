/*
 * @Author: DXY
 * @Date: 2021-01-19 16:39:43
 * @LastEditTime: 2021-01-21 16:49:22
 * @LastEditors: DXY
 * @Description: 
 * @FilePath: \obs-studio-node-example\operating-systems.js
 * @
 */
// Modified from https://github.com/stream-labs/streamlabs-obs/blob/staging/app/util/operating-systems.ts

const OS = {
  Windows: 'win32',
  Mac: 'darwin',
}

function byOS(handlers) {
  const handler = handlers[process.platform];
  if (typeof handler === 'function') return handler();

  return handler;
}

function getOS() {
  return process.platform
}

module.exports.OS = OS
module.exports.byOS = byOS
module.exports.getOS = getOS
