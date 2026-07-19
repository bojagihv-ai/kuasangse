const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

async function callInPage(cdp, fn, arg) {
  return evaluateFactoryCdpFixture(
    cdp,
    `fixture => (${fn.toString()})(fixture, ${JSON.stringify(arg)})`,
  );
}

(async () => {
  const cdpRuntime = await ensureCdp(CDP_URL);
  const target = (cdpRuntime.targets || []).find(item => item.type === 'page') || cdpRuntime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
    && typeof factoryCurrentProductKey === 'function'
    && typeof factoryStampLockedInputImage === 'function'`, 30000);

  const result = await callInPage(cdp, ({ cloneFactory, replaceFactory, setAppState }, { base64 }) => {
    const factory = cloneFactory();
    const oldName = '성능측정상품';
    const newName = '띠수네모동전지갑';
    const oldKey = factoryNormalizeIdentityText(oldName);
    const newKey = factoryNormalizeIdentityText(newName);
    // 상태 객체만 직접 바꿔서는 잠긴 기존 작업의 상품 기준을 탈취할 수 없어야 합니다.
    setAppState({
      productName: newName,
      imageBase64: base64,
      imageMime: 'image/png',
      imagePreview: `data:image/png;base64,${base64}`,
    });
    factory.product.userProductName = oldName;
    factory.product.productName = newName;
    factory.product.productKey = oldKey;
    factory.product.productIdentityKey = oldKey;
    factory.product.inputImages = [];
    const beforeKey = factoryCurrentProductKey(factory);
    const staleStateCouldHijack = beforeKey === newKey;
    // 실제 새 작업/제품명 입력 경로와 동일한 공식 함수로 현재 상품 기준을 전환합니다.
    factorySetCurrentProductIdentity(newName, {
      factory,
      syncDom: false,
      setSearchQuery: false,
      syncFinal: false,
    });
    factoryStampLockedInputImage(factory, {
      base64,
      mime: 'image/png',
      preview: `data:image/png;base64,${base64}`,
      name: '현재제품.png',
    }, { id: 'identity_drift_v88' });
    replaceFactory(factory);
    return {
      oldKey,
      newKey,
      beforeKey,
      staleStateCouldHijack,
      afterKey: factoryCurrentProductKey(factory),
      productName: factory.product.productName,
      userProductName: factory.product.userProductName,
      productKey: factory.product.productKey,
      productIdentityKey: factory.product.productIdentityKey,
      inputImageProductKey: factory.product.inputImages?.[0]?.productKey || '',
    };
  }, { base64: ONE_PIXEL_PNG });

  console.log(JSON.stringify(result, null, 2));
  assertChecks([
    { ok: result.staleStateCouldHijack === false, message: 'state.productName 직접 변경이 기존 잠금 상품 기준을 탈취했습니다.' },
    { ok: result.afterKey === result.newKey, message: `현재 productKey가 새 상품으로 바뀌지 않았습니다: ${result.afterKey}` },
    { ok: result.productKey === result.newKey, message: `factory.product.productKey가 stale입니다: ${result.productKey}` },
    { ok: result.productIdentityKey === result.newKey, message: `factory.product.productIdentityKey가 stale입니다: ${result.productIdentityKey}` },
    { ok: result.inputImageProductKey === result.newKey, message: `입력 이미지 productKey가 stale입니다: ${result.inputImageProductKey}` },
  ]);
  cdp.close();
  if (cdpRuntime.cleanup) await cdpRuntime.cleanup();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
