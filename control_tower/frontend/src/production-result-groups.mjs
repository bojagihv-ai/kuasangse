const DETAIL_SECTION_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'header', order: 1, label: '헤더·대표', tokens: Object.freeze(['header', '헤더']) }),
  Object.freeze({ key: 'hook', order: 2, label: '훅 사진', tokens: Object.freeze(['hook', '훅']) }),
  Object.freeze({ key: 'key_features', order: 3, label: '핵심 특징', tokens: Object.freeze(['key features', '핵심 특징']) }),
  Object.freeze({ key: 'specifications', order: 4, label: '상세 스펙', tokens: Object.freeze(['specifications', '상세 스펙']) }),
  Object.freeze({ key: 'use_scenarios', order: 5, label: '사용 시나리오', tokens: Object.freeze(['use scenarios', '사용 시나리오']) }),
  Object.freeze({ key: 'competitive_edge', order: 6, label: '비교 우위', tokens: Object.freeze(['competitive edge', '비교 우위']) }),
  Object.freeze({ key: 'material_tech', order: 7, label: '소재·기술', tokens: Object.freeze(['material & tech', 'material and tech', '소재 기술']) }),
  Object.freeze({ key: 'certifications', order: 8, label: '인증·수상', tokens: Object.freeze(['certifications', '인증 수상']) }),
  Object.freeze({ key: 'reviews', order: 9, label: '리뷰·후기', tokens: Object.freeze(['reviews', '리뷰 후기']) }),
  Object.freeze({ key: 'size_color', order: 10, label: '크기·컬러 가이드', tokens: Object.freeze(['size color', '크기 컬러', '색상옵션']) }),
  Object.freeze({ key: 'promotion', order: 11, label: '프로모션', tokens: Object.freeze(['promotion', '프로모션']) }),
  Object.freeze({ key: 'shipping', order: 12, label: '배송·포장', tokens: Object.freeze(['shipping', '배송 포장']) }),
  Object.freeze({ key: 'faq', order: 13, label: '자주 묻는 질문', tokens: Object.freeze(['faq', '자주 묻는 질문']) }),
  Object.freeze({ key: 'brand_story', order: 14, label: '브랜드 스토리', tokens: Object.freeze(['brand story', 'brand_story', '브랜드 스토리']) }),
  Object.freeze({ key: 'cta_footer', order: 15, label: 'CTA 푸터', tokens: Object.freeze(['cta footer', 'cta_footer', 'cta 푸터']) }),
]);

const FALLBACK_SECTION = Object.freeze({
  key: 'other',
  order: 99,
  label: '기타 상세 섹션',
  tokens: Object.freeze(),
});

function text(value) {
  return String(value ?? '').trim();
}

function normalizedAssetText(asset) {
  const metadata = asset && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata)
    ? asset.metadata
    : {};
  return [asset?.displayName, asset?.assetKey, metadata.sectionId, metadata.archiveFile]
    .map(text)
    .join(' ')
    .toLocaleLowerCase('ko-KR')
    .replaceAll('_', ' ')
    .replaceAll('&', ' and ')
    .replace(/\s+/g, ' ');
}

function sectionDefinition(asset) {
  const source = normalizedAssetText(asset);
  return DETAIL_SECTION_DEFINITIONS.find(section => section.tokens.some(token => source.includes(token)))
    || FALLBACK_SECTION;
}

function archiveSequence(asset) {
  const matched = /^(\d{6})_/.exec(text(asset?.displayName));
  return Number(matched?.[1] || 0);
}

export function groupWorkBundleSectionAssets(assets = []) {
  const grouped = new Map();
  for (const asset of Array.isArray(assets) ? assets : []) {
    const definition = sectionDefinition(asset);
    const current = grouped.get(definition.key) || { ...definition, assets: [] };
    current.assets.push(asset);
    grouped.set(definition.key, current);
  }
  return Object.freeze([...grouped.values()]
    .sort((left, right) => left.order - right.order)
    .map(group => {
      const orderedAssets = [...group.assets].sort((left, right) => archiveSequence(left) - archiveSequence(right));
      return Object.freeze({
        key: group.key,
        order: group.order,
        label: group.label,
        assets: Object.freeze(orderedAssets),
        latest: orderedAssets.at(-1) || null,
      });
    }));
}
