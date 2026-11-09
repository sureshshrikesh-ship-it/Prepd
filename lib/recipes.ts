// Tonight: a small library of high-protein recipes we own, ranked by what is in the user's fridge.
// Pure functions (no database) so they can be unit-tested.
import { countableAs, daysLeft, formatQty, type PantryItem } from "./pantry.ts";

export type RUnit = "g" | "ml" | "piece" | "tbsp" | "tsp";

export type Ingredient = {
  k: string;           // key steps refer to
  name: string;
  qty: number;         // for the recipe's base servings
  unit: RUnit;
  label?: string;      // singular noun for pieces: "egg", "wrap", "clove"
  m: string[];         // words that match a fridge item or an at-home staple
  x?: string[];        // words that rule a fridge item out ("egg" but not "egg noodles")
  each?: number;       // grams per piece when the fridge counts and the recipe weighs (a tin, a fillet)
  staple?: boolean;    // oil, spices, sauces: shown, never blocks a recipe, never taken off the fridge
  spice?: boolean;     // covered by "Spices" in the at-home list
  optional?: boolean;
};
export type Step = { text: string; uses?: string[]; timer?: number /* minutes */ };
export type Recipe = {
  id: string;
  title: string;
  blurb: string;
  meal: "breakfast" | "main";
  minutes: number;
  serves: number;
  protein: number;     // grams per serving, approximate
  kcal: number;        // per serving, approximate
  veg: boolean;
  contains: string[];  // for the avoid list: meat, chicken, beef, fish, dairy, egg, gluten
  keeps?: string;      // leftovers and food-safety note
  ingredients: Ingredient[];
  steps: Step[];
};

// ── Shared ingredients ────────────────────────────────────────────────────────
const OIL: Ingredient = { k: "oil", name: "Oil", qty: 1, unit: "tbsp", m: ["oil"], staple: true };
const SALT: Ingredient = { k: "salt", name: "Salt and pepper", qty: 1, unit: "tsp", m: ["salt"], staple: true };
const GARLIC = (n = 2): Ingredient => ({ k: "garlic", name: "Garlic", qty: n, unit: "piece", label: "clove", m: ["garlic"], staple: true });
const GINGER: Ingredient = { k: "ginger", name: "Ginger, grated", qty: 1, unit: "tsp", m: ["ginger"], staple: true };
const SOY = (n = 2): Ingredient => ({ k: "soy", name: "Soy sauce", qty: n, unit: "tbsp", m: ["soy sauce", "soy"], staple: true });
const spice = (k: string, name: string, qty: number, unit: RUnit, m: string[]): Ingredient => ({ k, name, qty, unit, m, staple: true, spice: true });
const CHICKEN_BREAST = (g: number): Ingredient => ({ k: "chicken", name: "Chicken breast", qty: g, unit: "g", m: ["chicken breast", "chicken fillet", "chicken thigh", "chicken"] });
const RICE = (g: number): Ingredient => ({ k: "rice", name: "Rice (dry)", qty: g, unit: "g", m: ["rice"], x: ["rice cake", "rice pudding", "rice noodle", "rice vinegar", "crispies"] });
const EGGS = (n: number): Ingredient => ({ k: "eggs", name: "Eggs", qty: n, unit: "piece", label: "egg", m: ["egg"], x: ["noodle", "mayo", "fried rice", "easter", "chocolate"] });
const ONION = (n = 1, k = "onion"): Ingredient => ({ k, name: "Onion", qty: n, unit: "piece", label: "onion", m: ["onion"], x: ["spring onion", "rings", "bhaji"] });
const PEPPER = (n: number): Ingredient => ({ k: "pepper", name: "Pepper", qty: n, unit: "piece", label: "pepper", m: ["pepper"], x: ["peppercorn", "black pepper", "salt", "stuffed", "jalape"] });
const TOMS: Ingredient = { k: "toms", name: "Chopped tomatoes", qty: 400, unit: "g", each: 400, m: ["chopped tomato", "tinned tomato", "plum tomato", "tomatoes in"], x: ["puree", "purée", "paste", "ketchup", "sun dried"] };
const SPINACH = (g: number, optional = false): Ingredient => ({ k: "spinach", name: "Spinach", qty: g, unit: "g", m: ["spinach"], optional });
const YOGURT = (g: number): Ingredient => ({ k: "yogurt", name: "Greek yogurt", qty: g, unit: "g", m: ["greek yog", "yogurt", "yoghurt", "skyr"], x: ["drink", "raisin", "coated", "frozen"] });
const CHEESE = (g: number): Ingredient => ({ k: "cheese", name: "Cheddar", qty: g, unit: "g", m: ["cheddar", "cheese", "mozzarella", "red leicester"], x: ["cream cheese", "cheesecake", "cheese string"] });
const WRAPS = (n: number): Ingredient => ({ k: "wraps", name: "Wraps", qty: n, unit: "piece", label: "wrap", each: 62, m: ["wrap", "tortilla", "flatbread"] });
const PASTA = (g: number): Ingredient => ({ k: "pasta", name: "Pasta (dry)", qty: g, unit: "g", m: ["pasta", "penne", "fusilli", "spaghetti", "macaroni", "rigatoni", "linguine", "tagliatelle"] });
const TUNA = (n: number): Ingredient => ({ k: "tuna", name: "Tinned tuna", qty: n, unit: "piece", label: "tin", each: 145, m: ["tuna"], x: ["mayo"] });
const SWEETCORN = (g: number): Ingredient => ({ k: "corn", name: "Sweetcorn", qty: g, unit: "g", each: 160, m: ["sweetcorn", "corn"], x: ["cornflake", "cornflour", "corned", "baby corn"] });
const BEANS: Ingredient = { k: "beans", name: "Kidney or black beans (tin)", qty: 400, unit: "g", each: 400, m: ["kidney bean", "black bean", "mixed bean", "chilli bean", "pinto"] };

const COOK_CHICKEN = "until no pink remains in the middle and the juices run clear";

export const RECIPES: Recipe[] = [
  {
    id: "chicken-fried-rice", title: "Chicken and egg fried rice", blurb: "A takeaway favourite with twice the protein.",
    meal: "main", minutes: 25, serves: 2, protein: 58, kcal: 600, veg: false, contains: ["meat", "chicken", "egg", "gluten"],
    keeps: "Cool any leftovers within an hour, keep in the fridge and eat within 24 hours.",
    ingredients: [RICE(150), CHICKEN_BREAST(300), EGGS(2), { k: "peas", name: "Frozen peas or mixed veg", qty: 100, unit: "g", m: ["peas", "pea", "frozen veg", "mixed veg"] },
      { k: "spring", name: "Spring onions", qty: 3, unit: "piece", label: "spring onion", m: ["spring onion"], optional: true }, SOY(2), GARLIC(2), OIL],
    steps: [
      { text: "Rinse the rice, then simmer it in salted water until tender. Drain and spread it out to steam dry.", uses: ["rice"], timer: 12 },
      { text: "While it cooks, cut the chicken into small pieces and slice the spring onions and garlic.", uses: ["chicken", "spring", "garlic"] },
      { text: `Heat the oil in a large pan on high. Fry the chicken ${COOK_CHICKEN}.`, uses: ["oil", "chicken"], timer: 7 },
      { text: "Add the garlic and peas and stir-fry for 2 minutes.", uses: ["garlic", "peas"], timer: 2 },
      { text: "Push everything to one side, crack in the eggs and scramble them, then stir through.", uses: ["eggs"] },
      { text: "Add the rice and soy sauce and toss until steaming hot. Top with spring onions.", uses: ["rice", "soy", "spring"], timer: 3 },
    ],
  },
  {
    id: "yogurt-chicken-traybake", title: "Yogurt chicken traybake", blurb: "Five minutes of work, the oven does the rest.",
    meal: "main", minutes: 40, serves: 2, protein: 55, kcal: 660, veg: false, contains: ["meat", "chicken", "dairy"],
    keeps: "Leftovers keep 2 days in the fridge. Reheat until steaming hot.",
    ingredients: [{ k: "chicken", name: "Chicken thighs, boneless", qty: 500, unit: "g", m: ["chicken thigh", "chicken breast", "chicken fillet", "chicken"] },
      YOGURT(150), PEPPER(2), { ...ONION(1), name: "Red onion" }, GARLIC(2), spice("paprika", "Paprika", 2, "tsp", ["paprika"]), SALT, OIL],
    steps: [
      { text: "Heat the oven to 220°C (200°C fan). Mix the yogurt, crushed garlic, paprika, salt and pepper in a bowl.", uses: ["yogurt", "garlic", "paprika", "salt"] },
      { text: "Coat the chicken in the yogurt mix.", uses: ["chicken"] },
      { text: "Cut the peppers and onion into chunks, toss with oil on a tray, and put the chicken on top.", uses: ["pepper", "onion", "oil"] },
      { text: `Roast ${COOK_CHICKEN}, and the edges are charred.`, timer: 30 },
    ],
  },
  {
    id: "shakshuka", title: "Eggs in spiced tomatoes", blurb: "Shakshuka-style, all in one pan. Great with toast.",
    meal: "main", minutes: 20, serves: 2, protein: 20, kcal: 400, veg: true, contains: ["egg", "gluten"],
    ingredients: [EGGS(4), TOMS, ONION(1), PEPPER(1), SPINACH(100, true),
      { k: "bread", name: "Bread", qty: 2, unit: "piece", label: "slice", each: 40, m: ["bread", "loaf", "sourdough", "toastie"] },
      GARLIC(2), spice("cumin", "Cumin", 1, "tsp", ["cumin"]), SALT, OIL],
    steps: [
      { text: "Slice the onion and pepper. Fry in the oil on medium until soft.", uses: ["onion", "pepper", "oil"], timer: 6 },
      { text: "Add the garlic and cumin for a minute, then the tomatoes. Simmer until thick.", uses: ["garlic", "cumin", "toms"], timer: 5 },
      { text: "Stir in the spinach until wilted. Season.", uses: ["spinach", "salt"] },
      { text: "Make 4 hollows, crack in the eggs, cover and cook until the whites are set.", uses: ["eggs"], timer: 6 },
      { text: "Serve with toast.", uses: ["bread"] },
    ],
  },
  {
    id: "tuna-sweetcorn-pasta", title: "Creamy tuna and sweetcorn pasta", blurb: "Cupboard food, 50 g of protein, 15 minutes.",
    meal: "main", minutes: 15, serves: 2, protein: 50, kcal: 680, veg: false, contains: ["fish", "dairy", "gluten"],
    keeps: "Good cold in a lunchbox the next day. Keep in the fridge.",
    ingredients: [PASTA(200), TUNA(2), SWEETCORN(150), YOGURT(100), CHEESE(40), SALT],
    steps: [
      { text: "Cook the pasta in salted boiling water.", uses: ["pasta"], timer: 11 },
      { text: "Drain the tuna and sweetcorn. Mix with the yogurt and grated cheese.", uses: ["tuna", "corn", "yogurt", "cheese"] },
      { text: "Drain the pasta, keeping a splash of water. Stir in the tuna mix, loosen with the water, season.", uses: ["pasta", "salt"] },
    ],
  },
  {
    id: "chicken-curry", title: "Weeknight chicken curry", blurb: "A lighter tikka-style curry made creamy with yogurt.",
    meal: "main", minutes: 35, serves: 2, protein: 66, kcal: 690, veg: false, contains: ["meat", "chicken", "dairy"],
    keeps: "Curry keeps 2 days in the fridge or 3 months frozen.",
    ingredients: [CHICKEN_BREAST(350), ONION(1), TOMS, YOGURT(150), GARLIC(3), GINGER,
      spice("masala", "Garam masala or curry powder", 2, "tsp", ["garam masala", "curry powder", "tikka", "masala"]), RICE(150), SALT, OIL],
    steps: [
      { text: "Put the rice on to simmer.", uses: ["rice"], timer: 12 },
      { text: "Fry the chopped onion in the oil until golden.", uses: ["onion", "oil"], timer: 8 },
      { text: "Add the garlic, ginger and spices for a minute.", uses: ["garlic", "ginger", "masala"] },
      { text: `Add the chicken in chunks and the tomatoes. Simmer ${COOK_CHICKEN}.`, uses: ["chicken", "toms"], timer: 12 },
      { text: "Take off the heat and stir in the yogurt so it doesn't split. Season and serve with the rice.", uses: ["yogurt", "salt", "rice"] },
    ],
  },
  {
    id: "beef-chilli", title: "Big-batch beef chilli", blurb: "Cook once on Sunday, eat four times.",
    meal: "main", minutes: 40, serves: 4, protein: 37, kcal: 560, veg: false, contains: ["meat", "beef"],
    keeps: "Chilli keeps 2 days in the fridge or 3 months frozen. Cook rice fresh, or eat cooked rice within 24 hours.",
    ingredients: [{ k: "mince", name: "Lean beef mince (5% fat)", qty: 500, unit: "g", m: ["beef mince", "minced beef", "steak mince", "mince"], x: ["turkey", "pork", "quorn", "lamb", "chicken"] },
      BEANS, TOMS, ONION(1), PEPPER(1), GARLIC(2), spice("chilli", "Chilli powder and cumin", 2, "tsp", ["chilli powder", "cumin", "chilli"]), RICE(300), SALT, OIL],
    steps: [
      { text: "Fry the chopped onion and pepper in the oil until soft.", uses: ["onion", "pepper", "oil"], timer: 6 },
      { text: "Add the mince and brown it all over, breaking it up.", uses: ["mince"], timer: 6 },
      { text: "Stir in the garlic and spices, then the tomatoes and drained beans.", uses: ["garlic", "chilli", "toms", "beans"] },
      { text: "Simmer, stirring now and then, until rich and thick. Meanwhile cook the rice.", uses: ["rice"], timer: 20 },
      { text: "Season. Eat now and cool the rest quickly to box up.", uses: ["salt"] },
    ],
  },
  {
    id: "turkey-bolognese", title: "Turkey mince bolognese", blurb: "Leaner than beef, just as comforting.",
    meal: "main", minutes: 30, serves: 4, protein: 40, kcal: 475, veg: false, contains: ["meat", "gluten"],
    keeps: "Sauce keeps 2 days in the fridge or 3 months frozen.",
    ingredients: [{ k: "mince", name: "Turkey mince", qty: 500, unit: "g", m: ["turkey mince", "turkey", "beef mince", "mince"], x: ["ham", "slices", "rasher", "pork", "quorn"] },
      PASTA(300), TOMS, ONION(1), { k: "carrot", name: "Carrot", qty: 1, unit: "piece", label: "carrot", m: ["carrot"] }, GARLIC(2),
      spice("herbs", "Dried mixed herbs", 1, "tsp", ["herbs", "oregano", "basil"]), SALT, OIL],
    steps: [
      { text: "Finely chop the onion and carrot and fry in the oil until soft.", uses: ["onion", "carrot", "oil"], timer: 6 },
      { text: "Add the mince and brown it, breaking it up.", uses: ["mince"], timer: 6 },
      { text: "Add the garlic, herbs and tomatoes. Simmer until the mince is cooked through and the sauce is thick.", uses: ["garlic", "herbs", "toms"], timer: 12 },
      { text: "Meanwhile cook the pasta. Season the sauce and serve.", uses: ["pasta", "salt"], timer: 11 },
    ],
  },
  {
    id: "honey-soy-salmon", title: "Honey soy salmon with rice and broccoli", blurb: "Restaurant-style in 25 minutes.",
    meal: "main", minutes: 25, serves: 2, protein: 33, kcal: 600, veg: false, contains: ["fish", "gluten"],
    ingredients: [{ k: "salmon", name: "Salmon fillets", qty: 2, unit: "piece", label: "fillet", each: 120, m: ["salmon"], x: ["smoked"] },
      RICE(150), { k: "broc", name: "Broccoli", qty: 300, unit: "g", each: 300, m: ["broccoli", "tenderstem"] }, SOY(2),
      { k: "honey", name: "Honey", qty: 1, unit: "tbsp", m: ["honey"], staple: true }, GARLIC(1)],
    steps: [
      { text: "Heat the oven to 200°C (180°C fan). Put the rice on to simmer.", uses: ["rice"], timer: 12 },
      { text: "Mix the soy, honey and crushed garlic. Spoon over the salmon on a lined tray.", uses: ["soy", "honey", "garlic", "salmon"] },
      { text: "Bake the salmon until it flakes easily and is opaque all the way through.", uses: ["salmon"], timer: 12 },
      { text: "Steam or boil the broccoli for the last few minutes. Serve together.", uses: ["broc"], timer: 4 },
    ],
  },
  {
    id: "protein-oats", title: "Overnight protein oats", blurb: "Make it at night, grab it on the way out. About 18 g protein without the powder.",
    meal: "breakfast", minutes: 5, serves: 1, protein: 40, kcal: 600, veg: true, contains: ["dairy", "gluten"],
    keeps: "Keeps 2 days in the fridge, so make two at once.",
    ingredients: [{ k: "oats", name: "Oats", qty: 50, unit: "g", m: ["oat", "porridge"], x: ["oat milk", "oatcake", "flapjack", "oat drink", "biscuit"] },
      { k: "milk", name: "Milk", qty: 150, unit: "ml", m: ["milk"], x: ["coconut", "oat milk", "chocolate", "milkshake", "condensed"] },
      YOGURT(100), { k: "powder", name: "Protein powder", qty: 30, unit: "g", m: ["protein powder", "whey"], optional: true },
      { k: "banana", name: "Banana or berries", qty: 1, unit: "piece", label: "banana", m: ["banana", "berries", "blueberr", "raspberr", "strawberr"], optional: true }],
    steps: [
      { text: "Stir the oats, milk, yogurt and protein powder together in a jar or box.", uses: ["oats", "milk", "yogurt", "powder"] },
      { text: "Cover and leave in the fridge overnight.", },
      { text: "In the morning, top with sliced banana or berries.", uses: ["banana"] },
    ],
  },
  {
    id: "chickpea-spinach-curry", title: "Chickpea and spinach curry", blurb: "Meat-free, filling, ready in 25 minutes.",
    meal: "main", minutes: 25, serves: 2, protein: 25, kcal: 500, veg: true, contains: ["dairy"],
    keeps: "Keeps 3 days in the fridge or 3 months frozen.",
    ingredients: [{ k: "chickpeas", name: "Chickpeas (2 tins)", qty: 800, unit: "g", each: 400, m: ["chickpea"] }, SPINACH(200), TOMS, ONION(1),
      GARLIC(2), GINGER, spice("masala", "Garam masala or curry powder", 2, "tsp", ["garam masala", "curry powder", "masala"]), YOGURT(100), SALT, OIL],
    steps: [
      { text: "Fry the chopped onion in the oil until golden.", uses: ["onion", "oil"], timer: 8 },
      { text: "Add the garlic, ginger and spices for a minute.", uses: ["garlic", "ginger", "masala"] },
      { text: "Add the tomatoes and drained chickpeas and simmer.", uses: ["toms", "chickpeas"], timer: 10 },
      { text: "Stir in the spinach until wilted. Off the heat, swirl in the yogurt and season.", uses: ["spinach", "yogurt", "salt"] },
    ],
  },
  {
    id: "eggs-smoked-salmon", title: "Scrambled eggs and smoked salmon on toast", blurb: "Ten minutes, 40 g of protein.",
    meal: "breakfast", minutes: 10, serves: 1, protein: 41, kcal: 605, veg: false, contains: ["fish", "egg", "gluten", "dairy"],
    ingredients: [EGGS(3), { k: "salmon", name: "Smoked salmon", qty: 60, unit: "g", m: ["smoked salmon"] },
      { k: "bread", name: "Bread", qty: 2, unit: "piece", label: "slice", each: 40, m: ["bread", "loaf", "sourdough"] },
      { k: "butter", name: "Butter", qty: 1, unit: "tsp", m: ["butter"], x: ["peanut"], staple: true }, SALT],
    steps: [
      { text: "Toast the bread.", uses: ["bread"] },
      { text: "Beat the eggs with salt and pepper. Melt the butter in a pan on low and stir the eggs gently until just set.", uses: ["eggs", "butter", "salt"], timer: 3 },
      { text: "Pile onto the toast and top with the smoked salmon.", uses: ["salmon"] },
    ],
  },
  {
    id: "chicken-fajita-wraps", title: "Chicken fajita wraps", blurb: "Fast, fun, and easy to box up for lunch.",
    meal: "main", minutes: 20, serves: 2, protein: 64, kcal: 790, veg: false, contains: ["meat", "chicken", "dairy", "gluten"],
    ingredients: [CHICKEN_BREAST(300), WRAPS(4), PEPPER(2), ONION(1),
      spice("fajita", "Fajita seasoning or paprika", 2, "tsp", ["fajita", "seasoning", "paprika", "cajun"]), YOGURT(100), CHEESE(40), OIL],
    steps: [
      { text: "Slice the chicken, peppers and onion into strips. Toss the chicken with the seasoning.", uses: ["chicken", "pepper", "onion", "fajita"] },
      { text: `Fry the chicken in the oil on high ${COOK_CHICKEN}.`, uses: ["oil", "chicken"], timer: 6 },
      { text: "Add the peppers and onion and fry until softened and charred.", uses: ["pepper", "onion"], timer: 5 },
      { text: "Warm the wraps. Fill with the chicken, a spoon of yogurt and grated cheese.", uses: ["wraps", "yogurt", "cheese"] },
    ],
  },
  {
    id: "red-lentil-dal", title: "Red lentil dal", blurb: "Cheap, high-fibre, and better the next day.",
    meal: "main", minutes: 30, serves: 3, protein: 18, kcal: 330, veg: true, contains: [],
    keeps: "Keeps 3 days in the fridge or 3 months frozen.",
    ingredients: [{ k: "lentils", name: "Red lentils", qty: 200, unit: "g", m: ["red lentil", "lentil"] }, ONION(1), TOMS, SPINACH(100, true),
      GARLIC(3), GINGER, spice("turmeric", "Turmeric and cumin", 2, "tsp", ["turmeric", "cumin"]), SALT, OIL],
    steps: [
      { text: "Rinse the lentils. Simmer them in 700 ml water with the turmeric until soft.", uses: ["lentils", "turmeric"], timer: 20 },
      { text: "Meanwhile fry the onion in the oil until golden, then add the garlic, ginger and cumin.", uses: ["onion", "oil", "garlic", "ginger"], timer: 8 },
      { text: "Add the tomatoes to the onions and cook down for 5 minutes.", uses: ["toms"], timer: 5 },
      { text: "Stir everything into the lentils with the spinach. Season.", uses: ["spinach", "salt"] },
    ],
  },
  {
    id: "ham-cheese-omelette", title: "Ham, cheese and spinach omelette", blurb: "The ten-minute dinner when you can't be bothered.",
    meal: "breakfast", minutes: 10, serves: 1, protein: 37, kcal: 450, veg: false, contains: ["meat", "egg", "dairy"],
    ingredients: [EGGS(3), CHEESE(30), { k: "ham", name: "Ham", qty: 50, unit: "g", m: ["ham"], x: ["hamburger"] }, SPINACH(50, true),
      { k: "butter", name: "Butter or oil", qty: 1, unit: "tsp", m: ["butter", "oil"], x: ["peanut"], staple: true }, SALT],
    steps: [
      { text: "Beat the eggs with salt and pepper. Tear the ham and grate the cheese.", uses: ["eggs", "ham", "cheese", "salt"] },
      { text: "Melt the butter in a frying pan on medium. Wilt the spinach, then pour in the eggs.", uses: ["butter", "spinach", "eggs"], timer: 2 },
      { text: "When almost set, scatter the ham and cheese over half, fold and cook until the eggs are fully set.", uses: ["ham", "cheese"], timer: 2 },
    ],
  },
  {
    id: "paneer-egg-bhurji", title: "Paneer and egg bhurji", blurb: "Spiced scramble, great in a wrap or with toast.",
    meal: "main", minutes: 15, serves: 2, protein: 33, kcal: 635, veg: true, contains: ["dairy", "egg"],
    ingredients: [{ k: "paneer", name: "Paneer", qty: 225, unit: "g", m: ["paneer"] }, EGGS(4), ONION(1),
      { k: "tomato", name: "Tomatoes", qty: 2, unit: "piece", label: "tomato", m: ["tomato"], x: ["chopped", "tinned", "puree", "purée", "paste", "ketchup", "sun dried", "in juice"] },
      PEPPER(1), spice("masala", "Turmeric and garam masala", 1, "tsp", ["turmeric", "garam masala", "masala"]), SALT, OIL],
    steps: [
      { text: "Chop the onion, tomatoes and pepper. Crumble the paneer.", uses: ["onion", "tomato", "pepper", "paneer"] },
      { text: "Fry the onion and pepper in the oil until soft, then add the tomatoes and spices.", uses: ["oil", "onion", "pepper", "tomato", "masala"], timer: 6 },
      { text: "Add the paneer and warm through.", uses: ["paneer"], timer: 2 },
      { text: "Pour in the beaten eggs and stir until set. Season.", uses: ["eggs", "salt"], timer: 2 },
    ],
  },
  {
    id: "prawn-noodles", title: "Garlic prawn noodles", blurb: "Faster than a takeaway delivery.",
    meal: "main", minutes: 15, serves: 2, protein: 35, kcal: 425, veg: false, contains: ["fish", "egg", "gluten"],
    ingredients: [{ k: "prawns", name: "Raw king prawns", qty: 300, unit: "g", m: ["prawn", "shrimp"], x: ["cocktail", "cracker"] },
      { k: "noodles", name: "Egg noodles", qty: 125, unit: "g", m: ["noodle"], x: ["pot noodle", "instant"] }, PEPPER(1),
      { k: "spring", name: "Spring onions", qty: 3, unit: "piece", label: "spring onion", m: ["spring onion"], optional: true }, GARLIC(3), GINGER, SOY(3), OIL],
    steps: [
      { text: "Cook the noodles as the pack says, then drain.", uses: ["noodles"], timer: 4 },
      { text: "Stir-fry the sliced pepper in the oil on high.", uses: ["oil", "pepper"], timer: 2 },
      { text: "Add the garlic, ginger and prawns. Cook until the prawns are pink all the way through.", uses: ["garlic", "ginger", "prawns"], timer: 3 },
      { text: "Toss in the noodles, soy and spring onions until hot.", uses: ["noodles", "soy", "spring"] },
    ],
  },
  {
    id: "tuna-jacket", title: "Tuna and sweetcorn jacket potatoes", blurb: "Microwave jackets, done in 15 minutes.",
    meal: "main", minutes: 15, serves: 2, protein: 38, kcal: 455, veg: false, contains: ["fish", "dairy"],
    ingredients: [{ k: "potato", name: "Baking potatoes", qty: 2, unit: "piece", label: "potato", m: ["baking potato", "potato"], x: ["sweet potato", "crisps", "wedges", "chips", "hash", "mash"] },
      TUNA(2), SWEETCORN(100), YOGURT(100), SALT],
    steps: [
      { text: "Prick the potatoes all over. Microwave on high, turning halfway, until soft in the middle.", uses: ["potato"], timer: 10 },
      { text: "Mix the drained tuna and sweetcorn with the yogurt. Season.", uses: ["tuna", "corn", "yogurt", "salt"] },
      { text: "Split the potatoes and pile in the filling.", },
    ],
  },
  {
    id: "chicken-rice-boxes", title: "Chicken, rice and broccoli prep boxes", blurb: "The classic gym meal prep, four boxes in 30 minutes.",
    meal: "main", minutes: 30, serves: 4, protein: 56, kcal: 505, veg: false, contains: ["meat", "chicken"],
    keeps: "Rice must be eaten within 24 hours of cooking. Freeze the boxes for later days as soon as they're cool, and reheat until steaming hot.",
    ingredients: [CHICKEN_BREAST(600), RICE(300), { k: "broc", name: "Broccoli", qty: 600, unit: "g", each: 300, m: ["broccoli", "tenderstem"] },
      spice("paprika", "Paprika and garlic granules", 2, "tsp", ["paprika", "garlic granules", "cajun", "seasoning"]), SALT, OIL],
    steps: [
      { text: "Put the rice on to simmer.", uses: ["rice"], timer: 12 },
      { text: "Slice the chicken and toss with the oil, spices and salt.", uses: ["chicken", "oil", "paprika", "salt"] },
      { text: `Fry the chicken in batches ${COOK_CHICKEN}.`, uses: ["chicken"], timer: 10 },
      { text: "Steam or boil the broccoli until just tender.", uses: ["broc"], timer: 4 },
      { text: "Divide into 4 boxes. Cool quickly, within an hour, then refrigerate or freeze.", },
    ],
  },
  {
    id: "yogurt-bowl", title: "Greek yogurt power bowl", blurb: "No cooking, three minutes.",
    meal: "breakfast", minutes: 3, serves: 1, protein: 22, kcal: 490, veg: true, contains: ["dairy", "gluten"],
    ingredients: [YOGURT(250), { k: "granola", name: "Granola or muesli", qty: 40, unit: "g", m: ["granola", "muesli"] },
      { k: "berries", name: "Berries or banana", qty: 80, unit: "g", m: ["berries", "blueberr", "raspberr", "strawberr", "frozen fruit", "banana"], optional: true },
      { k: "honey", name: "Honey", qty: 1, unit: "tsp", m: ["honey"], staple: true }],
    steps: [
      { text: "Spoon the yogurt into a bowl. Top with granola, fruit and a drizzle of honey.", uses: ["yogurt", "granola", "berries", "honey"] },
    ],
  },
  {
    id: "bean-quesadillas", title: "Bean and cheese quesadillas", blurb: "Crispy, cheesy and meat-free.",
    meal: "main", minutes: 15, serves: 2, protein: 28, kcal: 665, veg: true, contains: ["dairy", "gluten"],
    ingredients: [BEANS, CHEESE(80), WRAPS(4), PEPPER(1),
      { k: "spring", name: "Spring onions", qty: 2, unit: "piece", label: "spring onion", m: ["spring onion"], optional: true },
      spice("cumin", "Cumin or smoked paprika", 1, "tsp", ["cumin", "paprika"])],
    steps: [
      { text: "Drain the beans and roughly mash with the spice. Dice the pepper and slice the spring onions.", uses: ["beans", "cumin", "pepper", "spring"] },
      { text: "Spread the beans over 2 wraps, add the pepper, onions and grated cheese, and top with the other wraps.", uses: ["wraps", "cheese"] },
      { text: "Dry-fry each one on medium, flipping once, until crisp and the cheese melts.", timer: 6 },
    ],
  },
];

// ── Matching ───────────────────────────────────────────────────────────────────

// A fridge item with one of these words is only a match if the recipe asks for that word itself:
// "chicken stock cubes" are not chicken, "fajita seasoning" can be seasoning.
const EXCLUDE = ["stock", "cube", "powder", "flavour", "flavor", "seasoning", "crisps", "gravy", "soup", "sauce", "nugget", "kiev", "pie", "ready meal", "sandwich", "noodle"];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (text: string, w: string) => new RegExp(`(^|[^a-z])${esc(w)}`).test(text);

export function matchesItem(itemName: string, ing: Ingredient): boolean {
  const n = itemName.toLowerCase();
  if (ing.x?.some((w) => n.includes(w))) return false;
  if (EXCLUDE.some((w) => hasWord(n, w) && !ing.m.some((t) => t.includes(w)))) return false;
  return ing.m.some((t) => hasWord(n, t));
}

export function matchesHome(atHome: string[], ing: Ingredient): boolean {
  const home = atHome.map((a) => a.toLowerCase().trim()).filter(Boolean);
  if (ing.spice && home.includes("spices")) return true;
  return home.some((a) => !ing.x?.some((w) => a.includes(w)) && ing.m.some((t) => hasWord(a, t) || (a.length >= 4 && t.includes(a))));
}

/** Scale an ingredient amount to a number of servings, rounded to something you can measure. */
export function scaled(ing: Ingredient, serves: number, servings: number): number {
  const q = (ing.qty * servings) / serves;
  if (ing.unit === "g" || ing.unit === "ml") return q >= 20 ? Math.round(q / 5) * 5 : Math.round(q);
  return Math.max(0.5, Math.round(q * 2) / 2);
}

export function formatAmount(qty: number, unit: RUnit, label?: string): string {
  if (unit === "tbsp" || unit === "tsp") return `${qty} ${unit}`;
  return formatQty(qty, unit, label ?? null);
}

/** How much of a fridge item the recipe needs, in that item's own unit; null when we can't tell. */
export function needIn(ing: Ingredient, qty: number, item: Pick<PantryItem, "name" | "unit">): number | null {
  if (ing.unit === "tbsp" || ing.unit === "tsp" || item.unit === "pack") return null;
  const wet = (u: string) => u === "g" || u === "ml";
  if (ing.unit === item.unit || (wet(ing.unit) && wet(item.unit))) return qty;
  const each = countableAs(item.name)?.gramsEach ?? countableAs(ing.name)?.gramsEach ?? ing.each;
  if (!each) return null;
  if (ing.unit === "piece" && wet(item.unit)) return Math.round(qty * each);
  if (wet(ing.unit) && item.unit === "piece") return Math.max(1, Math.round(qty / each));
  return null;
}

export type Line = {
  ing: Ingredient;
  qty: number;                       // scaled amount in the recipe's unit
  item: PantryItem | null;           // the fridge item it comes from
  from: "fridge" | "home" | null;
  need: number | null;               // in the item's unit
  enough: boolean;
};

export type Check = {
  lines: Line[];
  missing: Line[];                   // main ingredients you don't have
  short: Line[];                     // in the fridge, but not enough
  soon: PantryItem[];                // fridge items it uses that go off within 2 days
};

export function checkRecipe(r: Recipe, servings: number, items: PantryItem[], atHome: string[], today = new Date()): Check {
  const stock = items.filter((i) => i.status === "active" && i.qty > 0);
  const taken = new Set<string>();
  const lines: Line[] = r.ingredients.map((ing) => {
    const qty = scaled(ing, r.serves, servings);
    const found = stock.filter((i) => !taken.has(i.id) && matchesItem(i.name, ing)).map((item) => {
      const need = ing.staple ? null : needIn(ing, qty, item);
      return { item, need, enough: need == null || item.qty >= need * 0.9 };
    }).sort((a, b) => Number(b.enough) - Number(a.enough) || byUseBy(a.item, b.item));
    const best = found[0];
    if (best && (best.enough || !matchesHome(atHome, ing))) {
      if (!ing.staple) taken.add(best.item.id);
      return { ing, qty, item: best.item, from: "fridge", need: best.need, enough: best.enough };
    }
    if (matchesHome(atHome, ing)) return { ing, qty, item: null, from: "home", need: null, enough: true };
    return { ing, qty, item: null, from: null, need: null, enough: false };
  });
  const mains = lines.filter((l) => !l.ing.staple && !l.ing.optional);
  const soon = lines.filter((l) => l.item && !l.ing.staple).map((l) => l.item!)
    .filter((i) => { const d = daysLeft(i.use_by, today); return d != null && d <= 2; });
  return { lines, missing: mains.filter((l) => !l.from), short: mains.filter((l) => l.from && !l.enough), soon };
}

function byUseBy(a: PantryItem, b: PantryItem): number {
  return (a.use_by ?? "9999").localeCompare(b.use_by ?? "9999");
}

/** Words from Settings › Avoid that rule a recipe out. */
export function avoided(r: Recipe, avoid: string): boolean {
  const words = avoid.toLowerCase().split(/[,;\n]|\band\b/).map((w) => w.trim()).filter((w) => w.length >= 3);
  if (!words.length) return false;
  const text = [...r.contains, ...r.ingredients.map((i) => i.name.toLowerCase())].join(" | ");
  return words.some((w) => {
    if (/^(vegetarian|veggie|no meat|meat)$/.test(w)) return !r.veg;
    if (/^vegan$/.test(w)) return r.contains.some((c) => ["meat", "fish", "dairy", "egg"].includes(c));
    if (/^(fish|seafood|shellfish|prawns?)$/.test(w)) return r.contains.includes("fish");
    if (/^(dairy|lactose|milk)$/.test(w)) return r.contains.includes("dairy");
    if (/^(eggs?)$/.test(w)) return r.contains.includes("egg");
    if (/^(gluten|wheat|coeliac)$/.test(w)) return r.contains.includes("gluten");
    return text.includes(w.replace(/s$/, ""));
  });
}

export type Ranked = { recipe: Recipe; check: Check };

/** Cook-now first, then one or two things to grab; within each, food going off first, then protein. */
export function rankRecipes(recipes: Recipe[], items: PantryItem[], atHome: string[], avoid = "", today = new Date()): Ranked[] {
  return recipes.filter((r) => !avoided(r, avoid))
    .map((recipe) => ({ recipe, check: checkRecipe(recipe, recipe.serves, items, atHome, today) }))
    .sort((a, b) =>
      a.check.missing.length - b.check.missing.length ||
      b.check.soon.length - a.check.soon.length ||
      fridgeUse(b) - fridgeUse(a) ||
      b.recipe.protein - a.recipe.protein);
}
const fridgeUse = (r: Ranked) => r.check.lines.filter((l) => l.from === "fridge" && !l.ing.staple).length;

/** What "I cooked it" proposes to take out of the fridge, in each item's own unit. */
export function deductions(check: Check): { item: PantryItem; ing: Ingredient; amount: number }[] {
  return check.lines.filter((l) => l.item && !l.ing.staple).map((l) => {
    const item = l.item!;
    let amount = l.need ?? (item.unit === "pack" && l.ing.unit === "g" && l.qty >= 250 ? 1 : 0);
    amount = Math.min(item.qty, Math.round(amount * 10) / 10);
    return { item, ing: l.ing, amount };
  });
}
