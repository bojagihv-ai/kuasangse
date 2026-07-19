
function factoryDbFieldSetting(factory, fieldId, defaultEnabled = true) {
  const settings = factory.product.dbFieldSettings || {};
  if (!settings[fieldId]) settings[fieldId] = { enabled: defaultEnabled, manualValue: '' };
  if (settings[fieldId].enabled === undefined) settings[fieldId].enabled = defaultEnabled;
  return settings[fieldId];
}

