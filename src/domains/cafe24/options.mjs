import { normalizeCafe24FieldId } from './fields.mjs';

function cleanOptionValue(value) {
  return String(value ?? '')
    .replace(/^\s*\d{1,3}\s*[.)-]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCafe24OptionValues(values = []) {
  const source = Array.isArray(values)
    ? values
    : String(values || '').split(/[,/|·;、\n\r]+/);
  const seen = new Set();
  const result = [];
  for (const raw of source) {
    const value = cleanOptionValue(raw);
    const key = value.toLocaleLowerCase('ko-KR');
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function normalizeCafe24OptionGroups(groups = [], fallbackName = '색상') {
  const source = Array.isArray(groups) ? groups : [];
  const result = [];
  for (const [index, group] of source.entries()) {
    const name = cleanOptionValue(group?.name || group?.option_name || (index === 0 ? fallbackName : `옵션 ${index + 1}`));
    const values = normalizeCafe24OptionValues(group?.values || group?.option_values || []);
    if (!values.length) continue;
    result.push(Object.freeze({
      name: name || fallbackName,
      key: normalizeCafe24FieldId(name || fallbackName),
      values: Object.freeze(values),
    }));
  }
  return result;
}

export function buildCafe24OptionModel(input = {}) {
  const optionName = cleanOptionValue(input.optionName || input.option_name || '색상') || '색상';
  const fallbackValues = normalizeCafe24OptionValues(input.optionValues || input.option_values || []);
  const groups = normalizeCafe24OptionGroups(input.groups || input.options || [], optionName);
  const normalizedGroups = groups.length
    ? groups
    : (fallbackValues.length ? [Object.freeze({ name: optionName, key: normalizeCafe24FieldId(optionName), values: Object.freeze(fallbackValues) })] : []);
  return Object.freeze({
    hasOption: normalizedGroups.length > 0,
    optionName,
    groups: Object.freeze(normalizedGroups),
    values: Object.freeze(normalizedGroups.flatMap(group => group.values)),
  });
}
