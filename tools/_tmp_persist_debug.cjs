const {ensureCdp, connectCdp, waitFor, evaluate} = require('\.\/factory_cdp_test_utils\.cjs');

(async () => {
  const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
  const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
  const cdpRuntime = await ensureCdp(CDP_URL);
  const target = (cdpRuntime.targets || []).find(t=>t.type==='page') || cdpRuntime.targets?.[0];
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', {url: APP_URL});
  await waitFor(cdp, '!!(window.state && window.render)', 60000);

  const seed = String(Date.now());
  const svgData = (label, color) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="${color}"/><text x="20" y="120" fill="#fff" font-size="64">${label}</text></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  };

  const result = await evaluate(cdp, `(async () => {
    const payload = {
      input: '${svgData('input-'+seed,'red').replace(/\n/g,'')}',
      hero: '${svgData('hero-'+seed,'blue').replace(/\n/g,'')}',
      size: '${svgData('size-'+seed,'green').replace(/\n/g,'')}',
      cuts: '${svgData('cuts-'+seed,'purple').replace(/\n/g,'')}',
    };
    const inputBase64 = payload.input.replace(/^data:image\/[^;,]+;base64,/i, '');
    const runId = 'dbg_run_'+Date.now();
    const productName='DbgProduct'+Date.now();
    const productKey = window.factoryNormalizeIdentityText?window.factoryNormalizeIdentityText(productName):productName;
    window.state.step='factory';
    window.state.productName=productName;
    window.state.currentProjectName=productName;
    window.state.imageBase64=inputBase64;window.state.imageMime='image/svg+xml';window.state.imagePreview=payload.input;window.state.imageName='in.svg';
    window.state.factory=window.normalizeFactoryState?window.normalizeFactoryState({}):{};
    const factory=window.factoryState();
    factory.product=window.factoryState().product||{};
    factory.product.productName=productName;
    factory.product.userProductName=productName;
    factory.product.currentRunId=runId;
    factory.product.generationRunId=runId;
    factory.product.lockedCurrentRunId=runId;
    factory.product.productKey=productKey;
    factory.product.lockedProductKey=productKey;
    factory.product.inputImageFingerprint=inputBase64.slice(0,30);
    factory.product.lockedInputImageFingerprint=factory.product.inputImageFingerprint;
    factory.product.imageBase64=inputBase64;
    factory.product.imageMime='image/svg+xml';
    factory.product.imagePreview=payload.input;
    factory.product.imageName='in.svg';
    factory.product.inputImages=[{id:'x',name:'in.svg',base64:inputBase64,mime:'image/svg+xml',preview:payload.input,hasImage:true,productKey,inputImageFingerprint:factory.product.inputImageFingerprint,currentRunId:runId,sourceImageKey:factory.product.inputImageFingerprint,productImageKey:factory.product.inputImageFingerprint}];
    factory.archive=factory.archive||{};
    factory.assets=[];
    factory.stages=factory.stages||{};
    ['hero','size','cuts'].forEach(id=>{factory.stages[id]={...(factory.stages[id]||{}),status:'done',currentRunId:runId,latestGenerationRunId:runId,message:'dbg'};});
    const out={};
    const runOne=(stageId, image,title)=>{
      const a=window.factoryRegisterAsset(stageId,image,{title,currentRunId:runId,generationRunId:runId,productKey, inputImageFingerprint:factory.product.inputImageFingerprint, used:true, skipLocalArchive:true, metadata:{productName,productKey,currentRunId:runId,generationRunId:runId,inputImageFingerprint:factory.product.inputImageFingerprint,stageId}, sourceMap:{productName,productKey,currentRunId:runId,generationRunId:runId,inputImageFingerprint:factory.product.inputImageFingerprint,stageId,source:'dbg'}});
      if(!a) return {ok:false,error:'register-failed'};
      return window.factoryQueueLocalArchiveAsset(a,'dbg').then(ok=>({ok, archiveId:a.archiveId||a.localArchive?.archiveId||'', imagePersistence:a.imagePersistence||'', localArchive:a.localArchive||{}, payloadImage:!!a.image, localArchiveError:a.localArchive?.error||''}));
    };
    const hero = await runOne('hero', payload.hero,'h');
    const size = await runOne('size', payload.size,'s');
    const cuts = await runOne('cuts', payload.cuts,'c');
    return { runId,productName,productKey,hero,size,cuts,all:[hero,size,cuts] };
  })()`);
  console.log(JSON.stringify(result, null, 2));
  cdp.close();
  await cdpRuntime.cleanup();
})();

