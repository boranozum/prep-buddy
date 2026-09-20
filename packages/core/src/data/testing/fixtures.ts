// Minimal valid ingredient/recipe fixtures for validator unit tests. Each
// function returns a fresh object (safe for a test to mutate in place to
// build a negative case). Not part of the package's public API.
export function validIngredientDoc(): Record<string, unknown> {
  return {
    schema_version: 1,
    id: 'carrot_raw',
    names: { en: 'Carrot, raw', tr: 'Havuç, çiğ' },
    aliases: { en: ['carrot'], tr: ['havuç'] },
    source: { dataset: 'usda_foundation', fdc_id: 100, snapshot_date: '2026-01-01' },
    per_100g: { kcal: 41, protein_g: 0.9, fat_g: 0.2, carbs_g: 9.6, fiber_g: 2.8 },
    allergens: [],
    diet_flags: [],
    shopping: { section: 'produce', pack_sizes_g: [500], staple: false },
  };
}

export function validIngredientLibrary(): Map<string, ReturnType<typeof validIngredientDoc>> {
  return new Map([['carrot_raw', validIngredientDoc()]]);
}

export function validRecipeDoc(): Record<string, unknown> {
  return {
    schema_version: 1,
    id: 'test_recipe',
    version: 1,
    status: 'draft',
    title: { en: 'Test recipe', tr: 'Test tarif' },
    description: { en: 'A minimal test recipe.', tr: 'Basit bir test tarifi.' },
    base_servings: 2,
    ingredients: [{ ingredient_id: 'carrot_raw', grams: 200, role: 'main' }],
    scaling: { min_factor: 0.75, max_factor: 1.5, flex: [] },
    tasks: [
      {
        id: 'wash_carrot',
        op: 'wash',
        inputs: ['carrot_raw'],
        outputs: ['washed_carrot'],
        needs: [],
        methods: [{ id: 'sink', baseline: true, requires: [], active: { fixed_min: 1 } }],
        text: {
          brief: { en: 'Wash the carrot.', tr: 'Havucu yıkayın.' },
          detailed: {
            en: 'Wash the carrot under cold water.',
            tr: 'Havucu soğuk su altında yıkayın.',
          },
        },
      },
      {
        id: 'dice_carrot',
        op: 'dice',
        inputs: ['washed_carrot'],
        outputs: ['diced_carrot'],
        needs: ['wash_carrot'],
        batch_key: 'dice:carrot_raw',
        methods: [
          {
            id: 'knife',
            baseline: true,
            requires: [],
            active: { fixed_min: 2, per_100g_min: 0.3 },
          },
        ],
        text: {
          brief: { en: 'Dice the carrot.', tr: 'Havucu doğrayın.' },
          detailed: {
            en: 'Dice the carrot into small pieces.',
            tr: 'Havucu küçük parçalar halinde doğrayın.',
          },
        },
      },
      {
        id: 'cook_carrot',
        op: 'boil',
        inputs: ['diced_carrot'],
        outputs: ['cooked_carrot'],
        needs: ['dice_carrot'],
        methods: [
          {
            id: 'stovetop',
            baseline: true,
            requires: [
              { capability: 'heat_source', count: 1 },
              { capability: 'pot', min_liters: 1 },
            ],
            active: { fixed_min: 2 },
            passive: { fixed_min: 10 },
          },
        ],
        text: {
          brief: { en: 'Boil the carrot.', tr: 'Havucu haşlayın.' },
          detailed: { en: 'Boil the carrot until tender.', tr: 'Havuç yumuşayana kadar haşlayın.' },
        },
      },
    ],
    storage: {
      fridge_days: 3,
      freezer_days: null,
      cooling_note: { en: 'Cool quickly.', tr: 'Hızlıca soğutun.' },
      reheat: { en: 'Reheat until hot.', tr: 'Sıcak olana kadar ısıtın.' },
    },
    authoring: { author: 'test', reviewed_by: {}, reviewed_at: null },
  };
}
