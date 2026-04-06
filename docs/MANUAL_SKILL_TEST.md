# Как вручную протестировать скилл `browser-platform`

Ниже минимальный ручной сценарий для проверки, что:

- CLI установлен и доступен в `PATH`
- daemon и сессии работают из OpenClaw workspace
- скилл подхватывается OpenClaw и реально вызывает `browser-platform`
- LitRes pack корректно матчится и возвращает ожидаемый контекст

## Что должно быть готово заранее

Предполагается, что вы уже:

- собрали проект
- выполнили `npm link`
- скопировали `openclaw/skill-template/SKILL.md` в OpenClaw skills
- перезапустили gateway или открыли новую сессию OpenClaw

Installer теперь по умолчанию подготавливает backend `camoufox`.

Если нужна полная установка с нуля, сначала пройдите шаги из [OPENCLAW_SETUP.md](./OPENCLAW_SETUP.md).

## Сценарий 1. Проверка runtime вручную через CLI

Запускайте команды именно из OpenClaw workspace, чтобы состояние daemon сохранялось в ожидаемом `.tmp/` каталоге:

```bash
cd ~/.openclaw/workspace
browser-platform daemon ensure --json
browser-platform session open --url https://www.litres.ru/ --profile litres --scenario manual-smoke --json
```

Сохраните `session` из ответа и выполните:

```bash
browser-platform session context --session <SESSION_ID> --json
browser-platform session observe --session <SESSION_ID> --json
browser-platform session close --session <SESSION_ID> --json
```

Ожидаемый результат:

- `daemon ensure` отрабатывает без ошибки
- `session open` возвращает `session`, `packContext` и `authContext`
- в `packContext` виден матч для `litres`
- `session observe` возвращает сводку по текущей странице
- `session close` успешно закрывает сессию

Дополнительно можно проверить простой action:

```bash
browser-platform session act --session <SESSION_ID> --json '{"action":"fill","role":"combobox","value":"1984"}'
browser-platform session act --session <SESSION_ID> --json '{"action":"click","role":"button","name":"Найти"}'
browser-platform session observe --session <SESSION_ID> --json
```

После этого в наблюдении должен быть виден переход к поисковой выдаче или хотя бы изменение состояния страницы.

## Сценарий 2. Проверка самого скилла в OpenClaw

Откройте новый чат в OpenClaw после перезагрузки gateway и дайте один из запросов:

- `Открой litres.ru и скажи, авторизована ли сессия.`
- `Открой litres.ru, найди книгу 1984 и покажи состояние страницы.`

Что считать успешной проверкой:

- агент видит скилл без ручного указания пути к CLI
- агент доходит до реального вызова `browser-platform`, а не отвечает теоретически
- по ответу видно, что была открыта живая страница и прочитан её контекст
- для `litres.ru` определяется корректный `packContext`
- если на сайте видна кнопка `Войти`, агент трактует сессию как неавторизованную

## Что проверить в проблемных случаях

- `browser-platform: command not found`:
  скорее всего, не выполнен `npm link` или текущий shell не видит глобальный bin-path.
- браузер не стартует:
  проверьте `python -m camoufox version` или `python3 -m camoufox version`.
- `packContext` пустой или сайт не матчится:
  убедитесь, что открывается именно `https://www.litres.ru/` и используется свежая сборка.
- сессия всегда анонимная:
  проверьте профиль, сценарий и наличие артефактов авторизации. `--storage-state` используйте только как legacy/debug/import override, если нужно явно подложить внешний state-файл.

## Минимальный критерий приёмки

Ручной тест можно считать пройденным, если выполняются оба условия:

- CLI-сценарий успешно проходит `daemon ensure -> session open -> context -> observe -> close`
- в OpenClaw-чате агент с подключённым скиллом открывает `litres.ru` и возвращает осмысленное состояние живой страницы
