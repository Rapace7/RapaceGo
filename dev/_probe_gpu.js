const { app } = require('electron');
app.whenReady().then(async () => {
  try {
    const basic = await app.getGPUInfo('basic');
    console.log('=== basic.gpuDevice ===');
    console.log(JSON.stringify(basic.gpuDevice, null, 1));
  } catch (e) { console.log('basic 失败:', e.message); }
  app.quit();
});
