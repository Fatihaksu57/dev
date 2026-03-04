// ============================================================
// constants.js – SiteSketch
// Surface types, DN sizes, tool definitions, tool lookup table
// ============================================================

const SURFACES = [
    { value: 'UNBEFESTIGT',     label: 'Unbefestigt' },
    { value: 'GEHWEGPLATTE',    label: 'Gehwegplatte' },
    { value: 'ASPHALT',         label: 'Asphalt' },
    { value: 'BETON',           label: 'Beton' },
    { value: 'PFLASTER',        label: 'Pflaster' },
    { value: 'MOSAIK',          label: 'Mosaik' },
    { value: 'GRANITPLATTEN',   label: 'Granitplatten' },
    { value: 'GESCHL_BAUWEISE', label: 'Geschl. Bauweise', color: '#003C71' }
];

const DNS = [
    { value: 'DN50',  label: 'DN50' },
    { value: 'DN100', label: 'DN100' }
];

const TOOL_GROUPS = {
    SELECT: { id: 'SELECT', name: 'Auswahl', icon: '↖', type: 'utility' },

    INSTALLATIONSROHR: { id: 'INSTALLATIONSROHR', name: 'Installationsrohr', color: '#06B6D4', type: 'line', unit: 'm', lineWidth: 5, dash: [12, 6] },
    TRASSE:            { id: 'TRASSE',            name: 'Trasse',            color: '#FF0000', type: 'line', unit: 'm', lineWidth: 5 },
    BESTANDSTRASSE:    { id: 'BESTANDSTRASSE',    name: 'Bestandstrasse',    color: '#EAB308', type: 'line', unit: null, lineWidth: 4, dash: [10, 5] },

    SCHACHT: {
        id: 'SCHACHT', name: 'Schacht', icon: '□', type: 'group',
        children: {
            SCHACHT_AZK: {
                id: 'SCHACHT_AZK', name: 'AZK', type: 'group',
                children: {
                    SCHACHT_AZK_NEU:      { id: 'SCHACHT_AZK_NEU',      name: 'AZK Neu',      color: '#DC2626', type: 'point', unit: 'Stk', symbol: '□', size: 26 },
                    SCHACHT_AZK_BESTAND:  { id: 'SCHACHT_AZK_BESTAND',  name: 'AZK Bestand',  color: '#003C71', type: 'point', unit: 'Stk', symbol: '□', size: 26 }
                }
            },
            SCHACHT_DAZK: {
                id: 'SCHACHT_DAZK', name: 'DAZK', type: 'group',
                children: {
                    SCHACHT_DAZK_NEU:     { id: 'SCHACHT_DAZK_NEU',     name: 'DAZK Neu',     color: '#DC2626', type: 'point', unit: 'Stk', symbol: '▬', size: 26 },
                    SCHACHT_DAZK_BESTAND: { id: 'SCHACHT_DAZK_BESTAND', name: 'DAZK Bestand', color: '#003C71', type: 'point', unit: 'Stk', symbol: '▬', size: 26 }
                }
            },
            SCHACHT_APL: {
                id: 'SCHACHT_APL', name: 'APL', type: 'group',
                children: {
                    SCHACHT_APL_NEU:      { id: 'SCHACHT_APL_NEU',      name: 'APL Neu',      color: '#16A34A', type: 'point', unit: 'Stk', symbol: '▯', size: 26 },
                    SCHACHT_APL_BESTAND:  { id: 'SCHACHT_APL_BESTAND',  name: 'APL Bestand',  color: '#6B7280', type: 'point', unit: 'Stk', symbol: '▯', size: 26 }
                }
            }
        }
    },

    MUFFE:                    { id: 'MUFFE',                    name: 'Muffe',          color: '#8B5CF6', type: 'point', unit: 'Stk', symbol: '◆',       size: 24 },
    BOHRUNG_HAUSEINFUEHRUNG:  { id: 'BOHRUNG_HAUSEINFUEHRUNG',  name: 'Bohrung HE',     color: '#F59E0B', type: 'point', unit: 'Stk', symbol: '⊕',       size: 28 },
    BOHRUNG_WANDDURCHFUEHRUNG:{ id: 'BOHRUNG_WANDDURCHFUEHRUNG',name: 'Bohrung WD',     color: '#DC2626', type: 'point', unit: 'Stk', symbol: '○_empty', size: 28 },
    BRANDSCHOTTUNG:           { id: 'BRANDSCHOTTUNG',           name: 'Brandschottung', color: '#B91C1C', type: 'point', unit: 'Stk', symbol: '🛡',       size: 28 },
    HINDERNIS:                { id: 'HINDERNIS',                name: 'Hindernis',      color: '#DC2626', type: 'point', unit: 'Stk', symbol: '⚠',        size: 30 },

    KABEL:         { id: 'KABEL',         name: 'Kabel',    color: '#7C3AED', type: 'line',      unit: 'm',  lineWidth: 3, dash: [6, 4] },
    LF_KANAL:      { id: 'LF_KANAL',      name: 'LF-Kanal', color: '#0891B2', type: 'line',      unit: 'm',  lineWidth: 6 },
    PFEIL:         { id: 'PFEIL',         name: 'Pfeil',    color: '#DC2626', type: 'arrow',     unit: null, lineWidth: 4 },
    MASSKETTE:     { id: 'MASSKETTE',     name: 'Maßkette', color: '#1D4ED8', type: 'dimension', unit: null, lineWidth: 2 },
    TEXT_CALL_OUT: { id: 'TEXT_CALL_OUT', name: 'Text',     color: '#1A1A2E', type: 'text' }
};

// Flat lookup table: id → tool definition (used everywhere)
const TOOLS = {};
function flattenTools(obj) {
    Object.values(obj).forEach(tool => {
        if (tool.type !== 'group') TOOLS[tool.id] = tool;
        if (tool.children) flattenTools(tool.children);
    });
}
flattenTools(TOOL_GROUPS);
