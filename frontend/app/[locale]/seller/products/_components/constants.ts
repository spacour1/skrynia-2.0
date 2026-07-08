import { DollarSign, Gamepad2, ImageIcon, Package, Shield, Star, Truck } from "lucide-react";
import type { LotForm } from "./types";

export const initialForm: LotForm = {
  title: "",
  shortDescription: "",
  description: "",
  categoryId: "",
  gameId: "",
  sectionId: "",
  productType: "service",
  price: "",
  oldPrice: "",
  currency: "UAH",
  stock: "1",
  server: "",
  platform: "",
  region: "",
  rank: "",
  deliveryType: "manual",
  deliveryTime: "instant",
  deliveryTemplate: "",
  autoDelivery: false,
  instantPublication: true
};

export const productTypes = [
  ["account", "Аккаунт"],
  ["key", "Ключ / код"],
  ["topup", "Пополнение"],
  ["boosting", "Бустинг"],
  ["service", "Услуга"],
  ["item", "Предмет"],
  ["currency", "Валюта"]
] as const;

export const deliveryTimes: Record<string, string> = {
  instant: "Сразу после оплаты",
  hour: "До 1 часа",
  day: "До 24 часов"
};

export const formSteps = [
  { title: "Основная информация", text: "Расскажите покупателям о вашем товаре или услуге.", icon: Package },
  { title: "Категория", text: "Выберите категорию и тип товара или услуги.", icon: Gamepad2 },
  { title: "Цена и наличие", text: "Укажите цену товара и количество.", icon: DollarSign },
  { title: "Характеристики", text: "Укажите параметры, которые важны для покупателя.", icon: Shield },
  { title: "Доставка", text: "Выберите способ доставки и сроки выполнения.", icon: Truck },
  { title: "Медиа", text: "Добавьте скриншоты или видео для доказательства.", icon: ImageIcon },
  { title: "Дополнительно", text: "Дополнительные опции для вашего лота.", icon: Star }
] as const;
