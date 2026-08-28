# Как откатить изменения сайта (цена 4900 + упрощённая форма)

## Что менялось

Цена футболки на сайте поднята до 4900 ₽, а форма заказа сокращена до трёх полей: 1–2 фото питомца, кличка и email. Убраны выбор приюта, ФИО, телефон, адрес и способ доставки, стиль принта, пол/размер/цвет футболки. На витрине остался только один дизайн — «Life is better», два других временно скрыты (их файлы и настройки никуда не делись). Загрузка фото в Google Drive и запись строки в таблицу устроены так же, как раньше.

## Вариант А — откатить всё одной командой (рекомендуется)

На вашем компьютере, в папке проекта:

```bash
git log --oneline -5
```

Найдите в списке коммит с сообщением про упрощение формы и цену 4900 (он будет самым свежим). Скопируйте его короткий хеш (первые 7 символов слева) и выполните:

```bash
git revert --no-edit <хеш-коммита>
git push origin main
```

Затем на сервере:

```bash
ssh -i ~/.ssh/dogood_timeweb root@72.56.39.162 "cd /opt/dogood && bash scripts/deploy-production.sh"
```

Через 2–3 минуты сайт вернётся к прежнему виду: цена 3999 ₽, полная форма, три дизайна на витрине.

Если что-то пошло не так — есть ещё точка отката в виде git-метки: `site-before-simplification`. Вернуть весь сайт ровно к этому состоянию:

```bash
git checkout site-before-simplification -- lib/landing-data.ts components/landing/order-form.tsx components/blocks/catalog-feature.tsx
git commit -m "Откат к версии сайта до упрощения формы"
git push origin main
```

## Вариант Б — вернуть только форму заказа, оставив новую цену

Если хочется вернуть старую форму, но цену 4900 ₽ сохранить:

```bash
cp docs/backup/order-form.before-simplification.tsx components/landing/order-form.tsx
```

Откройте `components/landing/order-form.tsx`, удалите первую строку `// BACKUP COPY — ...`, затем найдите строку `const SHIRT_PRICE_RUB = 3999;` и поставьте `4900`. Сохраните, закоммитьте и задеплойте:

```bash
git add components/landing/order-form.tsx
git commit -m "Вернуть полную форму заказа"
git push origin main
ssh -i ~/.ssh/dogood_timeweb root@72.56.39.162 "cd /opt/dogood && bash scripts/deploy-production.sh"
```

Точно так же можно вернуть только `lib/landing-data.ts` из `docs/backup/landing-data.before-simplification.ts` (например, чтобы вернуть три дизайна на витрину, оставив короткую форму).

## Если сомневаетесь

Ничего не удаляйте и не трогайте сами — пришлите этот файл и вашу задачу мне (или другому агенту Claude), и откат сделают за вас.
