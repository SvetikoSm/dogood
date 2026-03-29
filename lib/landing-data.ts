/**
 * Витрина: три базовых дизайна.
 * Фото подставляются автоматически из папок `public/products/speed|rainy|life/`
 * (см. `public/products/HOWTO.txt`). Пока файлов нет — используются URL ниже (Unsplash).
 */
export type CatalogDesign = {
  id: string;
  name: string;
  slug: string;
  priceRub: number;
  /** Главное фото таба */
  imageMain: string;
  /** Доп. ракурсы для галереи внутри таба */
  gallery: string[];
  shortLine: string;
  detailBullets: string[];
};

export const catalogDesignTemplates: CatalogDesign[] = [
  {
    id: "life",
    name: "«Life is better»",
    slug: "life-is-better",
    priceRub: 3999,
    imageMain:
      "https://images.unsplash.com/photo-1618354691373-d851c43c8d0b?w=900&q=80",
    gallery: [
      "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=600&q=80",
      "https://images.unsplash.com/photo-1562157873-818bc0726f68?w=600&q=80",
    ],
    shortLine: "Типографика и воздух — под настроение city casual.",
    detailBullets: [
      "Плотный хлопок, продуманный крой, принт без «короба» на груди.",
      "В макете вместо шаблонной графики — ваш питомец и кличка в стиле «Life is better».",
      "3 999 ₽, унисекс one size — как и в других моделях линейки.",
    ],
  },
  {
    id: "speed",
    name: "«Я — скорость»",
    slug: "ya-skorost",
    priceRub: 3999,
    imageMain:
      "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=900&q=80",
    gallery: [
      "https://images.unsplash.com/photo-1576566588028-4147f3842e27?w=600&q=80",
      "https://images.unsplash.com/photo-1503341504253-dff4815485f1?w=600&q=80",
    ],
    shortLine: "Динамичный графический ритм, острые акценты.",
    detailBullets: [
      "Печать на плотном хлопке премиального качества, современный крой, оверсайз — подходит под разные фигуры.",
      "В этом дизайне мы заменим графику на портрет вашей собаки и кличку — как при оформлении заказа.",
      "3 999 ₽ за футболку.",
    ],
  },
  {
    id: "rainy",
    name: "«No rainy days»",
    slug: "no-rainy-days",
    priceRub: 3999,
    imageMain:
      "https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=900&q=80",
    gallery: [
      "https://images.unsplash.com/photo-1620799140408-ed534d60b329?w=600&q=80",
      "https://images.unsplash.com/photo-1622445275463-afa2ab738c34?w=600&q=80",
    ],
    shortLine: "Спокойная палитра и характер без лишнего шума.",
    detailBullets: [
      "Тот же плотный хлопок и аккуратная посадка: вещь, которую хочется носить каждый день.",
      "Мы встроим вашу собаку и имя в готовую композицию стиля «No rainy days».",
      "3 999 ₽ — фиксированная цена футболки.",
    ],
  },
];

export type ShelterSocialLink = { label: string; url: string };

export type Shelter = {
  id: string;
  name: string;
  city: string;
  description: string;
  /** Короткие тезисы для модалки (без телефонов и «пишите в Telegram» — только смысл) */
  detailBlocks: string[];
  /** Сайты и соцсети (кликабельные ссылки) */
  socialLinks: ShelterSocialLink[];
};

export const shelters: Shelter[] = [
  {
    id: "super-sobaka",
    name: "Супер Собака",
    city: "Москва",
    description:
      "Дом для собак на севере Москвы: официальный приют САО, куда попадают псы после отлова. Здесь их лечат, кормят и ищут семью — на площадке одновременно живут сотни хвостов, и каждому нужен человек.",
    detailBlocks: [
      "Это муниципальный приют с понятными правилами: анкеты собак, новости и то, чем реально можно помочь, — всё собрано на их страницах (ссылки ниже).",
      "Познакомиться с подопечными и узнать про визиты удобнее прямо на сайте и в сообществе — там же делятся буднями приюта.",
    ],
    socialLinks: [
      { label: "Сайт", url: "https://super-sobaka.ru/" },
      { label: "ВКонтакте", url: "https://vk.com/supersobakas" },
    ],
  },
  {
    id: "shelter-tails",
    name: "Shelter Tails",
    city: "Частные кураторы",
    description:
      "Настя и Юля ведут проект не «по шаблону»: берутся за собак в тяжёлых ситуациях и доводят историю до тёплого дома. По их подсчётам, в новые семьи уже ушли около 490 собак.",
    detailBlocks: [
      "Это не большой муниципальный корпус, а живые кураторы рядом — со сложными случаями, передержками и долгим сопровождением.",
      "Свежие истории и объявления они публикуют там, где удобно подписчикам — загляните по ссылкам ниже.",
    ],
    socialLinks: [
      {
        label: "Instagram",
        url: "https://www.instagram.com/shelter_tails?igsh=MXVqdHM5eGlneWRl",
      },
      { label: "Telegram-канал", url: "https://t.me/sheltertails" },
    ],
  },
  {
    id: "getdog-himki",
    name: "GetDog",
    city: "Химки (Московская область)",
    description:
      "Приют для собак в Химках: за время работы команда приняла у себя около 600 собак. Здесь кормят, лечат и ищут для каждого пса свой дом — с теплом и вниманием к каждой истории.",
    detailBlocks: [
      "На сайте приюта — расписание, новости и конкретные просьбы о помощи: корм, вещи, участие в сборах.",
      "Повседневная жизнь приюта и срочные объявления удобно читать в Telegram-канале; ссылки — ниже.",
    ],
    socialLinks: [
      { label: "Сайт", url: "https://getsuperdog.ru/" },
      { label: "Telegram-канал", url: "https://t.me/getdog500" },
    ],
  },
  {
    id: "priut-iskra",
    name: "Искра",
    city: "Москва",
    description:
      "«Искра» — муниципальный приют и для собак, и для кошек: собаки к ним попадают с отлова. За время работы новый дом нашли 150 собак и 55 кошек — цифры, которыми команда по праву гордится.",
    detailBlocks: [
      "Волонтёрам, корму и передержкам здесь всегда рады — как именно помочь, расписано на официальном сайте.",
      "Анкеты собак, новости и отчёты по сборам — на сайте; живые фото и будни приюта — в Instagram.",
    ],
    socialLinks: [
      { label: "Сайт", url: "https://priutiskra.ru/" },
      { label: "Instagram", url: "https://www.instagram.com/iskra_shelter/" },
    ],
  },
];

/** Три стиля принта = три дизайна витрины */
export const printStyles = [
  { value: "life", label: "«Life is better»" },
  { value: "speed", label: "«Я — скорость»" },
  { value: "rainy", label: "«No rainy days»" },
] as const;

export const shirtColors = [
  { value: "black", label: "Чёрный" },
  { value: "white", label: "Белый" },
] as const;

export const deliveryMethods = [
  { value: "wb", label: "Wildberries" },
  { value: "cdek", label: "СДЭК" },
  { value: "yandex", label: "Яндекс Доставка" },
] as const;
