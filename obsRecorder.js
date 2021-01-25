/*
 * @Author: DXY
 * @Date: 2021-01-19 16:39:43
 * @LastEditTime: 2021-01-25 16:20:36
 * @LastEditors: DXY
 * @Description: 
 * @FilePath: \obs-studio-node-example\obsRecorder.js
 * @
 */
const path = require('path');
const { Subject } = require('rxjs');
const { first } = require('rxjs/operators');
const { byOS, OS, getOS } = require('./operating-systems');

const osn = require("obs-studio-node");
const { v4: uuid } = require('uuid');
let nwr;

// NWR在mac上通过IOSurface处理显示渲染
if (getOS() === OS.Mac) {
  nwr = require('node-window-rendering');
}

let obsInitialized = false;
let scene = null;

// 初始化库，启动OBS Studio实例，配置它，设置源和场景
function initialize(win) {
  if (obsInitialized) {
    console.warn("OBS is already initialized, skipping initialization.");
    return;
  }

  initOBS();
  configureOBS();
  scene = setupScene();
  setupSources(scene);

  obsInitialized = true;

  const perfStatTimer = setInterval(() => {
    win.webContents.send("performanceStatistics", osn.NodeObs.OBS_API_getPerformanceStatistics());
  }, 1000);

  win.on('close', () => clearInterval(perfStatTimer));
}

// 初始化obs
function initOBS() {
  console.debug('Initializing OBS...');
  osn.NodeObs.IPC.host(`obs-studio-node-example-${uuid()}`); // 这里的uuid也可以换成时间戳
  osn.NodeObs.SetWorkingDirectory(path.join(__dirname, 'node_modules', 'obs-studio-node')); 

  const obsDataPath = path.join(__dirname, 'osn-data'); // OBS Studio configs and logs
  // 参数:区域设置、存储配置和日志的目录路径、应用程序版本
  const initResult = osn.NodeObs.OBS_API_initAPI('en-US', obsDataPath, '1.0.0');

  if (initResult !== 0) {
    const errorReasons = {
      '-2': 'DirectX could not be found on your system. Please install the latest version of DirectX for your machine here <https://www.microsoft.com/en-us/download/details.aspx?id=35?> and try again.',
      '-5': 'Failed to initialize OBS. Your video drivers may be out of date, or Streamlabs OBS may not be supported on your system.',
    }

    const errorMessage = errorReasons[initResult.toString()] || `An unknown error #${initResult} was encountered while initializing OBS.`;

    console.error('OBS init failure', errorMessage);

    shutdown();

    throw Error(errorMessage);
  }

  osn.NodeObs.OBS_service_connectOutputSignals((signalInfo) => {
    signals.next(signalInfo);
  });

  console.debug('OBS initialized');
}

function configureOBS() {
  console.debug('Configuring OBS');
  setSetting('Output', 'Mode', 'Advanced');
  const availableEncoders = getAvailableValues('Output', 'Recording', 'RecEncoder');
  setSetting('Output', 'RecEncoder', availableEncoders.slice(-1)[0] || 'x264');
  setSetting('Output', 'RecFilePath', path.join(__dirname, 'videos'));
  setSetting('Output', 'RecFormat', 'mkv');
  setSetting('Output', 'VBitrate', 10000); // 10 Mbps
  setSetting('Video', 'FPSCommon', 60);

  console.debug('OBS Configured');
}

// 获取关于主显示器的信息
function displayInfo() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;
  const { scaleFactor } = primaryDisplay;
  return {
    width,
    height,
    scaleFactor: scaleFactor,
    aspectRatio: width / height,
    physicalWidth: width * scaleFactor,
    physicalHeight: height * scaleFactor,
  }
}

// 获取照相机数据
function getCameraSource() {
  console.debug('Trying to set up web camera...')

  // 安装输入不初始化任何设备，只是获得可用的列表
  const dummyInput = byOS({
    [OS.Windows]: () =>
      osn.InputFactory.create('dshow_input', 'video', {
        audio_device_id: 'does_not_exist',
        video_device_id: 'does_not_exist',
      }),
    [OS.Mac]: () =>
      osn.InputFactory.create('av_capture_input', 'video', {
        device: 'does_not_exist',
      })
  });

  const cameraItems = dummyInput.properties.get(byOS({ [OS.Windows]: 'video_device_id', [OS.Mac]: 'device' })).details.items;
  console.debug(cameraItems)
  dummyInput.release();

  if (cameraItems.length === 0) {
    console.debug('No camera found!!')
    return null;
  }

  const deviceId = cameraItems[0].value;
  cameraItems[0].selected = true;
  console.debug('cameraItems[0].name: ' + cameraItems[0].name);

  const obsCameraInput = byOS({
    [OS.Windows]: () =>
      osn.InputFactory.create('dshow_input', 'video', {
        video_device_id: deviceId,
      }),
    [OS.Mac]: () =>
      osn.InputFactory.create('av_capture_input', 'video', {
        device: deviceId,
      }),
  })

  // It's a hack to wait a bit until device become initialized (maximum for 1 second)
  // If you know proper way how to determine whether camera is working and how to subscribe for any events from it, create a pull request
  // See discussion at https://github.com/Envek/obs-studio-node-example/issues/10
  for (let i = 1; i <= 4; i++) {
    if (obsCameraInput.width === 0) {
      const waitMs = 100 * i;
      console.debug(`Waiting for ${waitMs}ms until camera get initialized.`);
      busySleep(waitMs); // We can't use async/await here
    }
  }

  if (obsCameraInput.width === 0) {
    console.debug(`Found camera "${cameraItems[0].name}" doesn't seem to work as its reported width is still zero.`);
    return null;
  }

  // Way to update settings if needed:
  // let settings = obsCameraInput.settings;
  // console.debug('Camera settings:', obsCameraInput.settings);
  // settings['width'] = 320;
  // settings['height'] = 240;
  // obsCameraInput.update(settings);
  // obsCameraInput.save();

  return obsCameraInput;
}

// 桌面共享处理
function setupScene() {
  // const videoSource = osn.InputFactory.create(byOS({ [OS.Windows]: 'monitor_capture', [OS.Mac]: 'display_capture' }), 'desktop-video');

  const videoSource = osn.InputFactory.create('monitor_capture', 'desktop-video');
  // console.debug('videoSource', videoSource)

  const { physicalWidth, physicalHeight, aspectRatio } = displayInfo();

  // 更新源设置:
  let settings = videoSource.settings;
  // 这个参数修改使用哪个显示器,从0开始
  settings['monitor'] = 0;
  settings['width'] = physicalWidth;
  settings['height'] = physicalHeight;
  videoSource.update(settings);
  videoSource.save();

  // 设置输出视频大小为1920x1080
  const outputWidth = 1920;
  const outputHeight = Math.round(outputWidth / aspectRatio);
  setSetting('Video', 'Base', `${outputWidth}x${outputHeight}`);
  setSetting('Video', 'Output', `${outputWidth}x${outputHeight}`);
  const videoScaleFactor = physicalWidth / outputWidth;

  // 这里需要一个场景来适当缩放捕获的屏幕大小以输出视频大小
  const scene = osn.SceneFactory.create('test-scene');
  const sceneItem = scene.add(videoSource);
  sceneItem.scale = { x: 1.0 / videoScaleFactor, y: 1.0 / videoScaleFactor };

  // 如果相机可用，使它的宽度为视频的1/3，并把它放在显示器的正下角
  const cameraSource = getCameraSource();

  if (cameraSource) {
    const cameraItem = scene.add(cameraSource);
    const cameraScaleFactor = 1.0 / (3.0 * cameraSource.width / outputWidth);
    cameraItem.scale = { x: cameraScaleFactor, y: cameraScaleFactor };
    cameraItem.position = {
      x: outputWidth - cameraSource.width * cameraScaleFactor - outputWidth / 10,
      y: outputHeight - cameraSource.height * cameraScaleFactor - outputHeight / 10,
    };
    cameraItem.moveTop();
  }

  return scene;
}

function getAudioDevices(type, subtype) {
  const dummyDevice = osn.InputFactory.create(type, subtype, { device_id: 'does_not_exist' });
  const devices = dummyDevice.properties.get('device_id').details.items.map(({ name, value }) => {
    return { device_id: value, name, };
  });
  dummyDevice.release();
  return devices;
};

// 摄像头（调用照相机）
function setupSources() {
  // const audioSource = osn.InputFactory.create('wasapi_output_capture', 'desktop-audio');
  // const micSource = osn.InputFactory.create('wasapi_input_capture', 'mic-audio');

  // // Tell recorder to use this source (I'm not sure if this is the correct way to use the first argument `channel`)
  // osn.Global.setOutputSource(1, scene);
  // osn.Global.setOutputSource(2, audioSource);
  // osn.Global.setOutputSource(3, micSource);

  osn.Global.setOutputSource(1, scene);

  setSetting('Output', 'Track1Name', 'Mixed: all sources');
  let currentTrack = 2;

  getAudioDevices(byOS({ [OS.Windows]: 'wasapi_output_capture', [OS.Mac]: 'coreaudio_output_capture' }), 'desktop-audio').forEach(metadata => {
    if (metadata.device_id === 'default') return;
    const source = osn.InputFactory.create(byOS({ [OS.Windows]: 'wasapi_output_capture', [OS.Mac]: 'coreaudio_output_capture' }), 'desktop-audio', { device_id: metadata.device_id });
    setSetting('Output', `Track${currentTrack}Name`, metadata.name);
    source.audioMixers = 1 | (1 << currentTrack - 1); // 位掩码只输出到轨道1和当前轨道
    osn.Global.setOutputSource(currentTrack, source);
    currentTrack++;
  });

  getAudioDevices(byOS({ [OS.Windows]: 'wasapi_input_capture', [OS.Mac]: 'coreaudio_input_capture' }), 'mic-audio').forEach(metadata => {
    if (metadata.device_id === 'default') return;
    const source = osn.InputFactory.create(byOS({ [OS.Windows]: 'wasapi_input_capture', [OS.Mac]: 'coreaudio_input_capture' }), 'mic-audio', { device_id: metadata.device_id });
    setSetting('Output', `Track${currentTrack}Name`, metadata.name);
    source.audioMixers = 1 | (1 << currentTrack - 1); // 位掩码只输出到轨道1和当前轨道
    osn.Global.setOutputSource(currentTrack, source);
    currentTrack++;
  });

  setSetting('Output', 'RecTracks', parseInt('1'.repeat(currentTrack - 1), 2)); // Bit mask of used tracks: 1111 to use first four (from available six)
}

const displayId = 'display1';

function setupPreview(window, bounds) {

  osn.NodeObs.OBS_content_createSourcePreviewDisplay(
    window.getNativeWindowHandle(),
    scene.name, // 或者这里使用camera source Id
    displayId,
  );

  osn.NodeObs.OBS_content_setShouldDrawUI(displayId, false);
  osn.NodeObs.OBS_content_setPaddingSize(displayId, 0);
  // 填充颜色与主窗口背景颜色匹配
  osn.NodeObs.OBS_content_setPaddingColor(displayId, 255, 255, 255);

  const result = resizePreview(window, bounds);

  return result
}

let existingWindow = false
let initY = 0
function resizePreview(window, bounds) {

  let { aspectRatio, scaleFactor } = displayInfo();
  if (getOS() === OS.Mac) {
    scaleFactor = 1
  }
  const displayWidth = Math.floor(bounds.width);
  const displayHeight = Math.round(displayWidth / aspectRatio);
  const displayX = Math.floor(bounds.x);
  const displayY = Math.floor(bounds.y);

  if (initY === 0) {
    initY = displayY
  }
  osn.NodeObs.OBS_content_resizeDisplay(displayId, displayWidth * scaleFactor, displayHeight * scaleFactor);

  if (getOS() === OS.Mac) {
    if (existingWindow) {
      nwr.destroyWindow(displayId);
      nwr.destroyIOSurface(displayId);
    }
    const surface = osn.NodeObs.OBS_content_createIOSurface(displayId)
    nwr.createWindow(
      displayId,
      window.getNativeWindowHandle(),
    );
    nwr.connectIOSurface(displayId, surface);
    nwr.moveWindow(displayId, displayX * scaleFactor, (initY - displayY + initY) * scaleFactor)
    existingWindow = true
  } else {
    osn.NodeObs.OBS_content_moveDisplay(displayId, displayX * scaleFactor, displayY * scaleFactor);
  }

  return { height: displayHeight }
}

// 开始录制
async function start() {
  if (!obsInitialized) initialize();

  let signalInfo;

  console.debug('Starting recording...');
  osn.NodeObs.OBS_service_startRecording();

  console.debug('Started?');
  signalInfo = await getNextSignalInfo();

  if (signalInfo.signal === 'Stop') {
    throw Error(signalInfo.error);
  }

  console.debug('Started signalInfo.type:', signalInfo.type, '(expected: "recording")');
  console.debug('Started signalInfo.signal:', signalInfo.signal, '(expected: "start")');
  console.debug('Started!');
}

// 结束录制
async function stop() {
  let signalInfo;

  console.debug('Stopping recording...');
  osn.NodeObs.OBS_service_stopRecording();
  console.debug('Stopped?');

  signalInfo = await getNextSignalInfo();

  console.debug('On stop signalInfo.type:', signalInfo.type, '(expected: "recording")');
  console.debug('On stop signalInfo.signal:', signalInfo.signal, '(expected: "stopping")');

  signalInfo = await getNextSignalInfo();

  console.debug('After stop signalInfo.type:', signalInfo.type, '(expected: "recording")');
  console.debug('After stop signalInfo.signal:', signalInfo.signal, '(expected: "stop")');

  console.debug('Stopped!');
}

// 关闭软件
function shutdown() {
  if (!obsInitialized) {
    console.debug('OBS is already shut down!');
    return false;
  }

  console.debug('Shutting down OBS...');

  try {
    osn.NodeObs.OBS_service_removeCallback();
    osn.NodeObs.IPC.disconnect();
    obsInitialized = false;
  } catch (e) {
    throw Error('Exception when shutting down OBS process' + e);
  }

  console.debug('OBS shutdown successfully');

  return true;
}

function setSetting(category, parameter, value) {
  let oldValue;
  // 要设置容器
  const settings = osn.NodeObs.OBS_settings_getSettings(category).data;

  settings.forEach(subCategory => {
    subCategory.parameters.forEach(param => {
      if (param.name === parameter) {
        oldValue = param.currentValue;
        param.currentValue = value;
      }
    });
  });

  // 保存更新的设置容器
  if (value != oldValue) {
    osn.NodeObs.OBS_settings_saveSettings(category, settings);
  }
}

function getAvailableValues(category, subcategory, parameter) {
  const categorySettings = osn.NodeObs.OBS_settings_getSettings(category).data;

  if (!categorySettings) {
    console.warn(`There is no category ${category} in OBS settings`);
    return [];
  }

  const subcategorySettings = categorySettings.find(sub => sub.nameSubCategory === subcategory);
  if (!subcategorySettings) {
    console.warn(`There is no subcategory ${subcategory} for OBS settings category ${category}`);
    return [];
  }

  const parameterSettings = subcategorySettings.parameters.find(param => param.name === parameter);
  if (!parameterSettings) {
    console.warn(`There is no parameter ${parameter} for OBS settings category ${category}.${subcategory}`);
    return [];
  }

  return parameterSettings.values.map(value => Object.values(value)[0]);
}

const signals = new Subject();

function getNextSignalInfo() {
  return new Promise((resolve, reject) => {
    signals.pipe(first()).subscribe(signalInfo => resolve(signalInfo));
    setTimeout(() => reject('Output signal timeout'), 30000);
  });
}

function busySleep(sleepDuration) {
  var now = new Date().getTime();
  while (new Date().getTime() < now + sleepDuration) { /* do nothing */ };
}

// 设置显示器
function selectDisPlay(index) {
  const scene = osn.SceneFactory.fromName('test-scene');
  //console.log(scene.getItems().length)

  scene.getItems().map(item => {
    //console.log(item.source.name)
    // 删除
    if ('desktop-video' === item.source.name) {
      osn.InputFactory.fromName(item.source.name).release()
      item.remove();
    }
  })

  const videoSource = osn.InputFactory.create('monitor_capture', 'desktop-video');
  const { physicalWidth, physicalHeight, aspectRatio } = displayInfo(index.id);
  // Update source settings:
  let settings = videoSource.settings;

  // 这个参数修改使用哪个显示器,从0开始
  settings['monitor'] = parseInt(index.id)
  settings['width'] = physicalWidth;
  settings['height'] = physicalHeight;
  videoSource.update(settings);
  videoSource.save();

  const newitem = scene.add(videoSource);
  const outputWidth = 1920;
  const videoScaleFactor = physicalWidth / outputWidth;
  const outputHeight = Math.round(outputWidth / aspectRatio);
  setSetting('Video', 'Base', `${outputWidth}x${outputHeight}`);
  setSetting('Video', 'Output', `${outputWidth}x${outputHeight}`);
  newitem.scale = { x: 1.0 / videoScaleFactor, y: 1.0 / videoScaleFactor };
  newitem.moveBottom()

  scene.save()
  return scene;
}

// 获取设置信息
function getSetting(cate) {
  // console.log(electron.screen.getAllDisplays())
  return osn.NodeObs.OBS_settings_getSettings(cate.name).data;
}

// 获取摄像头数据
function getALlCameras() {
  const dummyInput = osn.InputFactory.create('dshow_input', 'video', {
    audio_device_id: 'does_not_exist',
    video_device_id: 'does_not_exist',
  });

  const cameraItems = dummyInput.properties.get('video_device_id').details.items;

  dummyInput.release();

  return cameraItems;
}

// 获取显示器
function getAllScene() {
  // 遍历 osn.Global.getOutputSource() 根据type判断 ESourceType === 3
  //console.log(scene)
  //console.log(scene.name)
  return new Array({
    name: scene.name, items: scene.getItems().map(function (item) {
      return item.source.name;
    })
  });
  // return new Array(scene);
}

// 设置并展示源数据
function showSourceInfo(name) {
  return scene.getItems().filter(item => {
    return name.id == item.source.name
  }).map(item => {
    let r = { name: item.source.name, width: item.source.width, height: item.source.height, x: item.position.x, y: item.position.y, visible: item.visible };
    console.log(r)
    return r;
  })
}

// 修改流地址
function udpateRtmp(window, settings) {

  // 设置流地址和key
  setSetting('Stream', 'server', settings.server)
  setSetting('Stream', 'key', settings.key)
  return true;

}

// 开始直播和结束直播
function toggleStreaming(state) {
  console.debug('streamingState:',state)
  if (!state) {
    osn.NodeObs.OBS_service_startStreaming();
  } else {
    osn.NodeObs.OBS_service_stopStreaming(true);
  }
}

module.exports.initialize = initialize;
module.exports.start = start;
module.exports.stop = stop;
module.exports.shutdown = shutdown;
module.exports.setupPreview = setupPreview;
module.exports.resizePreview = resizePreview;
module.exports.selectDisPlay = selectDisPlay;
module.exports.getSetting = getSetting;
module.exports.getALlCameras = getALlCameras;
module.exports.getAllScene = getAllScene;
module.exports.showSourceInfo = showSourceInfo;
module.exports.udpateRtmp = udpateRtmp;
module.exports.toggleStreaming = toggleStreaming;
