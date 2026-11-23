/**
 * Shared by the Damage, Level and Resource Calculators (spec 8.3, 8.9): the stored preset shapes they read from
 * each other, level math (XP tables, stat growth, level-up costs), a line chart and small inputs.
 */
export * from './docs'
export * from './levels'
export { LineChart, type ChartSeries } from './LineChart'
export { ticks } from './ticks'
export { NumberInput, PresetHeader } from './inputs'
export { useEditSession } from './editSession'
export { useDamagePresets, type DamagePreset } from './useDamagePresets'
