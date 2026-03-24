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
];

export type Shelter = {
  id: string;
  name: string;
  city: string;
  description: string;
  location: string;
  detailBlocks: string[];
  imageUrl: string;
  /** Ссылка на соцсеть (замените на реальную) */
  socialLabel: string;
  socialUrl: string;
};

export const shelters: Shelter[] = [
  {
    id: "tail-nsk",
    name: "Хвостики Новосибирска",
    city: "Новосибирск",
    description:
      "Небольшой частный приют: лечение, социализация и поиск дома для собак с улицы.",
    location: "Новосибирск, Центральный район",
    detailBlocks: [
      "Спасают собак с улицы, лечат и готовят к домашней жизни.",
      "Работают с волонтерами и передержками, помогают с адаптацией.",
      "Регулярно публикуют отчеты и истории подопечных.",
    ],
    imageUrl:
      "https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=1200&q=80",
    socialLabel: "ВКонтакте",
    socialUrl: "https://vk.com/example_tail_nsk",
  },
  {
    id: "ray-spb",
    name: "Рэй Санкт-Петербург",
    city: "Санкт-Петербург",
    description:
      "Волонтёрская команда и передержки. Прозрачная отчётность по расходам и заборам.",
    location: "Санкт-Петербург, север города",
    detailBlocks: [
      "Фокус на экстренных спасениях и лечении сложных случаев.",
      "Сопровождают новые семьи после пристройства собак.",
      "Проводят городские сборы корма и лекарств.",
    ],
    imageUrl:
      "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=1200&q=80",
    socialLabel: "Telegram",
    socialUrl: "https://t.me/example_ray_spb",
  },
  {
    id: "dobro-ekb",
    name: "Добро Екатеринбург",
    city: "Екатеринбург",
    description:
      "Фокус на сложных случаях: длительная реабилитация и работа с поведением.",
    location: "Екатеринбург, южная часть города",
    detailBlocks: [
      "Берут собак после травм и помогают восстановиться.",
      "Есть кинологическая поддержка и работа с поведением.",
      "Подбирают семьи с учетом характера каждой собаки.",
    ],
    imageUrl:
      "https://images.unsplash.com/photo-1537151625747-768eb6cf92b2?w=1200&q=80",
    socialLabel: "ВКонтакте",
    socialUrl: "https://vk.com/example_dobro_ekb",
  },
  {
    id: "shans-kzn",
    name: "Шанс Казань",
    city: "Казань",
    description:
      "Приют и клиника на одной площадке: стерилизация, прививки, адаптация к людям.",
    location: "Казань, Приволжский район",
    detailBlocks: [
      "На базе приюта работает ветподдержка и карантинная зона.",
      "Помогают собакам пройти вакцинацию и социализацию.",
      "Активно ищут дом и курируют первые месяцы адаптации.",
    ],
    imageUrl:
      "https://images.unsplash.com/photo-1583512603806-077998240c7a?w=1200&q=80",
    socialLabel: "Instagram",
    socialUrl: "https://instagram.com/example_shans_kzn",
  },
];

/** Три стиля принта = три дизайна витрины */
export const printStyles = [
  { value: "speed", label: "«Я — скорость»" },
  { value: "rainy", label: "«No rainy days»" },
  { value: "life", label: "«Life is better»" },
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
