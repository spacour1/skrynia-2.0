"use client";

import { useEffect } from "react";
import { type Language, useLanguageStore } from "../lib/i18n";

const dictionary: Record<Language, Record<string, string>> = {
  ru: {},
  en: {
    "Каталог": "Catalog",
    "Мои покупки": "My purchases",
    "Мои продажи": "My sales",
    "Избранное": "Favorites",
    "Поддержка": "Support",
    "Настройки": "Settings",
    "Создать лот": "Create listing",
    "Твой маркетплейс цифровых ценностей": "Your digital goods marketplace",
    "Покупай и продавай аккаунты, предметы, валюту, ключи и услуги с безопасным escrow.": "Buy and sell accounts, items, currency, keys, and services with secure escrow.",
    "Переглянути товари": "Browse products",
    "Как это работает": "How it works",
    "Гарант сделок": "Deal escrow",
    "Средства в escrow": "Funds in escrow",
    "Поддержка 24/7": "Support 24/7",
    "Telegram и тикеты": "Telegram and tickets",
    "Отзывы и рейтинг": "Reviews and rating",
    "Только после заказа": "Only after an order",
    "Мгновенная выдача": "Instant delivery",
    "Для ключей и кодов": "For keys and codes",
    "Игры и сервисы": "Games and services",
    "Каталог предложений": "Offer catalog",
    "Выберите игру, платформу или сервис. Карточки адаптируются под экран и не обрезают иконки.": "Choose a game, platform, or service. Cards adapt to the screen and keep icons visible.",
    "Показать все": "Show all",
    "Свернуть": "Collapse",
    "Выбрано": "Selected",
    "Открыть разделы": "Open sections",
    "Все разделы": "All sections",
    "Популярные сервисы": "Popular services",
    "Популярные товары": "Popular products",
    "Избранные товары": "Favorite products",
    "Все товары": "All products",
    "Новые": "Newest",
    "Больше продаж": "More sales",
    "Скидки": "Discounts",
    "Цена ниже": "Lower price",
    "Цена выше": "Higher price",
    "Рейтинг": "Rating",
    "Загружаем товары...": "Loading products...",
    "Товары не найдены.": "No products found.",
    "Пока нет избранных товаров.": "No favorite products yet.",
    "Безопасные сделки": "Secure deals",
    "Честный рейтинг": "Fair rating",
    "Последние действия": "Recent activity",
    "Посмотреть все": "View all",
    "Общий чат": "General chat",
    "Минималистичный вход в сообщения и диалоги по заказам.": "Minimal entry to messages and order dialogs.",
    "Игры": "Games",
    "Мобильные игры": "Mobile games",
    "Сервисы": "Services",
    "Программы": "Software",
    "Скоро будет наполнено": "Coming soon",
    "Кошелек": "Wallet",
    "История операций": "Transaction history",
    "Пополнить баланс": "Top up balance",
    "Вывести средства": "Withdraw funds",
    "Доступно к выводу": "Available to withdraw",
    "В Escrow": "In Escrow",
    "В обработке": "Processing",
    "Операция": "Operation",
    "Дата": "Date",
    "Статус": "Status",
    "Сумма": "Amount",
    "Профиль": "Profile",
    "Пароль": "Password",
    "Сохранить профиль": "Save profile",
    "Сменить пароль": "Change password",
    "Описание публичного профиля": "Public profile description",
    "Светлая тема": "Light theme",
    "Темная тема": "Dark theme",
    "Тема интерфейса": "Interface theme",
    "Выберите тему. Страница перезагрузится и откроется уже в новом оформлении.": "Choose a theme. The page will reload in the new appearance.",
    "Создание лота": "Listing creation",
    "Новый товар": "New product",
    "Категория товара": "Product category",
    "Игра или сервис": "Game or service",
    "Раздел внутри игры": "Section inside the game",
    "Описание, заголовок и цена": "Description, title and price",
    "Опубликовать лот": "Publish listing",
    "Предпросмотр": "Preview",
    "Категория": "Category",
    "Игра": "Game",
    "Раздел": "Section",
    "Тип": "Type",
    "Цена": "Price",
    "Чаты": "Chats",
    "Поиск по чатам": "Search chats",
    "Непрочитанные": "Unread",
    "Заказы": "Orders",
    "Все": "All",
    "Онлайн": "Online",
    "Смотреть заказ": "View order",
    "Написать сообщение...": "Write a message...",
    "Главная": "Home"
  },
  uk: {
    "Каталог": "Каталог",
    "Чаты": "Чати",
    "Мои покупки": "Мої покупки",
    "Мои продажи": "Мої продажі",
    "Избранное": "Обране",
    "Поддержка": "Підтримка",
    "Настройки": "Налаштування",
    "Создать лот": "Створити лот",
    "Твой маркетплейс цифровых ценностей": "Твій маркетплейс цифрових цінностей",
    "Покупай и продавай аккаунты, предметы, валюту, ключи и услуги с безопасным escrow.": "Купуй і продавай акаунти, предмети, валюту, ключі та послуги з безпечним escrow.",
    "Переглянути товари": "Переглянути товари",
    "Как это работает": "Як це працює",
    "Гарант сделок": "Гарант угод",
    "Средства в escrow": "Кошти в escrow",
    "Поддержка 24/7": "Підтримка 24/7",
    "Telegram и тикеты": "Telegram і тікети",
    "Отзывы и рейтинг": "Відгуки та рейтинг",
    "Только после заказа": "Тільки після замовлення",
    "Мгновенная выдача": "Миттєва видача",
    "Для ключей и кодов": "Для ключів і кодів",
    "Игры и сервисы": "Ігри та сервіси",
    "Каталог предложений": "Каталог пропозицій",
    "Показать все": "Показати все",
    "Свернуть": "Згорнути",
    "Выбрано": "Вибрано",
    "Открыть разделы": "Відкрити розділи",
    "Все разделы": "Усі розділи",
    "Популярные сервисы": "Популярні сервіси",
    "Популярные товары": "Популярні товари",
    "Избранные товары": "Обрані товари",
    "Все товары": "Усі товари",
    "Новые": "Нові",
    "Больше продаж": "Більше продажів",
    "Скидки": "Знижки",
    "Цена ниже": "Ціна нижче",
    "Цена выше": "Ціна вище",
    "Рейтинг": "Рейтинг",
    "Загружаем товары...": "Завантажуємо товари...",
    "Товары не найдены.": "Товари не знайдено.",
    "Пока нет избранных товаров.": "Поки немає обраних товарів.",
    "Безопасные сделки": "Безпечні угоди",
    "Честный рейтинг": "Чесний рейтинг",
    "Последние действия": "Останні дії",
    "Посмотреть все": "Переглянути все",
    "Общий чат": "Загальний чат",
    "Минималистичный вход в сообщения и диалоги по заказам.": "Мінімалістичний вхід у повідомлення та діалоги за замовленнями.",
    "Игры": "Ігри",
    "Мобильные игры": "Мобільні ігри",
    "Сервисы": "Сервіси",
    "Программы": "Програми",
    "Скоро будет наполнено": "Скоро буде наповнено",
    "Кошелек": "Гаманець",
    "История операций": "Історія операцій",
    "Пополнить баланс": "Поповнити баланс",
    "Вывести средства": "Вивести кошти",
    "Доступно к выводу": "Доступно до виводу",
    "В Escrow": "В Escrow",
    "В обработке": "В обробці",
    "Операция": "Операція",
    "Дата": "Дата",
    "Статус": "Статус",
    "Сумма": "Сума",
    "Профиль": "Профіль",
    "Пароль": "Пароль",
    "Сохранить профиль": "Зберегти профіль",
    "Сменить пароль": "Змінити пароль",
    "Описание публичного профиля": "Опис публічного профілю",
    "Светлая тема": "Світла тема",
    "Темная тема": "Темна тема",
    "Тема интерфейса": "Тема інтерфейсу",
    "Выберите тему. Страница перезагрузится и откроется уже в новом оформлении.": "Оберіть тему. Сторінка перезавантажиться вже в новому оформленні.",
    "Создание лота": "Створення лота",
    "Новый товар": "Новий товар",
    "Категория товара": "Категорія товару",
    "Игра или сервис": "Гра або сервіс",
    "Раздел внутри игры": "Розділ усередині гри",
    "Описание, заголовок и цена": "Опис, заголовок і ціна",
    "Опубликовать лот": "Опублікувати лот",
    "Предпросмотр": "Передперегляд",
    "Категория": "Категорія",
    "Игра": "Гра",
    "Раздел": "Розділ",
    "Тип": "Тип",
    "Цена": "Ціна",
    "Поиск по чатам": "Пошук по чатах",
    "Непрочитанные": "Непрочитані",
    "Заказы": "Замовлення",
    "Все": "Усі",
    "Онлайн": "Онлайн",
    "Смотреть заказ": "Переглянути замовлення",
    "Написать сообщение...": "Написати повідомлення...",
    "Главная": "Головна"
  }
};

const selector = "body *:not(script):not(style):not(svg):not(path)";

export function GlobalTranslator() {
  const language = useLanguageStore((state) => state.language);

  useEffect(() => {
    translatePage(language);
    const observer = new MutationObserver(() => translatePage(language));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [language]);

  return null;
}

function translatePage(language: Language) {
  const map = dictionary[language];
  const reverse = buildReverseMap();
  document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    if (element.closest("[data-no-translate]")) return;

    if (element.childNodes.length === 1 && element.childNodes[0]?.nodeType === Node.TEXT_NODE) {
      const current = element.textContent?.trim();
      if (!current) return;
      const base = reverse[current] ?? current;
      const next = map[base] ?? base;
      if (element.textContent !== next) element.textContent = next;
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const current = element.placeholder?.trim();
      if (!current) return;
      const base = reverse[current] ?? current;
      const next = map[base] ?? base;
      if (element.placeholder !== next) element.placeholder = next;
    }
  });
}

function buildReverseMap() {
  const reverse: Record<string, string> = {};
  Object.values(dictionary).forEach((map) => {
    Object.entries(map).forEach(([base, translated]) => {
      reverse[translated] = base;
    });
  });
  return reverse;
}
