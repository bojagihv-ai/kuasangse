export const SIDEBAR_TARGETS = Object.freeze([
  ['upload', 'src/menus/upload-menu.mjs', 'product-analysis', 'menu:v1 + product commands', 'MENU-UPLOAD'],
  ['analyzing', 'src/menus/analysis-menu.mjs', 'product-analysis', 'menu:v1 + analysis commands', 'MENU-ANALYSIS'],
  ['competitor', 'src/menus/competitor-menu.mjs', 'competitors', 'menu:v1 + competitor commands', 'MENU-COMP'],
  ['sections', 'src/menus/sections-menu.mjs', 'detail-document', 'menu:v1 + section commands', 'MENU-SECTIONS'],
  ['generating', 'src/menus/generating-menu.mjs', 'detail-document', 'menu:v1 + generation commands', 'MENU-GENERATE'],
  ['preview', 'src/menus/preview-menu.mjs', 'detail-document', 'menu:v1 + preview selectors', 'MENU-PREVIEW'],
  ['imagecuts', 'src/menus/imagecuts-menu.mjs', 'image-cuts', 'menu:v1 + cut commands', 'MENU-CUTS'],
  ['optionsorter', 'src/menus/optionsorter-menu.mjs', 'options', 'menu:v1 + option commands', 'MENU-OPTIONS'],
  ['factory', 'src/menus/factory/factory-menu.mjs', 'factory', 'menu:v1 + factory composition', 'MENU-FACTORY'],
  ['automation', 'src/menus/automation-menu.mjs', 'automation', 'menu:v1 + automation commands', 'MENU-AUTO'],
  ['modelsettings', 'src/menus/modelsettings-menu.mjs', 'app-preferences', 'menu:v1 + settings commands', 'MENU-SETTINGS'],
  ['manual', 'src/menus/manual-menu.mjs', 'manual-ui', 'menu:v1', 'MENU-MANUAL'],
]);

export const FACTORY_TAB_TARGETS = Object.freeze([
  ['factory/start', 'src/menus/factory/tabs/start-tab.mjs', 'factory', 'factory-tab:v1', 'FACTORY-START'],
  ['factory/db', 'src/menus/factory/tabs/db-tab.mjs', 'product-db', 'factory-tab:v1', 'FACTORY-DB'],
  ['factory/fields', 'src/menus/factory/tabs/fields-tab.mjs', 'product-db', 'factory-tab:v1', 'FACTORY-FIELDS'],
  ['factory/competitor', 'src/menus/factory/tabs/competitor-tab.mjs', 'competitors', 'factory-tab:v1', 'FACTORY-COMP'],
  ['factory/assets', 'src/menus/factory/tabs/assets-tab.mjs', 'factory-assets', 'factory-tab:v1', 'FACTORY-ASSETS'],
  ['factory/sections', 'src/menus/factory/tabs/sections-tab.mjs', 'detail-document', 'factory-tab:v1', 'FACTORY-SECTIONS'],
  ['factory/publish', 'src/menus/factory/tabs/publish-tab.mjs', 'cafe24', 'factory-tab:v1', 'FACTORY-PUBLISH'],
]);
