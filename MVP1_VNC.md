# MVP1 — VNC / noVNC handoff

Это план следующего этапа после завершения MVP0.

Цель MVP1: добавить **human handoff** для живых browser sessions, не ломая уже доказанную связку:

```text
OpenClaw skill -> exec -> browser-platform CLI -> daemon -> Playwright
```

VNC/noVNC здесь — не новый основной runtime, а **временный human override/debug surface** для сложных шагов:
- Sber ID / OTP
- нестабильный login gate
- непонятное состояние UI
- безопасная остановка на payment boundary
- ручное восстановление сценария, если агент застрял

---

## 1. Что считаем успехом MVP1

К концу MVP1 система должна уметь:

1. для существующей browser session включить handoff
2. вернуть агенту structured JSON с параметрами handoff:
   - `active`
   - `mode`
   - `sessionId`
   - `connect`
   - `reason`
   - `startedAt`
3. дать человеку подключиться к той же живой browser session через VNC / noVNC
4. при активном handoff не допускать конфликтного agent control
5. после ручного шага позволить агенту выполнить `resume` на **той же** session
6. записать handoff lifecycle в trace artifacts
7. сохранить безопасную границу: handoff не означает автоматического продолжения рискованных действий

---

## 2. Что НЕ входит в MVP1

На этом этапе не включаем:
- публичный internet exposure по умолчанию
- multi-user handoff
- полноценный web UI управления платформой
- always-on video recording всех сессий
- сложную auth систему для handoff-портала
- cloud relay / hosted service

Если понадобится внешний доступ, это должно включаться **явной настройкой**, а не по умолчанию.

---

## 3. Основная идея архитектуры

Текущий runtime остаётся прежним:

```text
OpenClaw skill
-> exec
-> browser-platform CLI
-> browser-platform daemon
-> Playwright
```

Добавляется handoff layer:

```text
daemon
-> browser session
-> display / VNC backend
-> optional noVNC web frontend
```

Принципиально важно:
- агент остаётся основным оператором flow
- человек подключается только на сложных границах
- после handoff агент продолжает **ту же** session
- traces фиксируют, где был человек, а где агент

---

## 4. LitRes-driven scope для MVP1

MVP1 делаем не абстрактно, а вокруг уже проверенных живых LitRes boundary.

### Сценарий A — Auth handoff

Триггеры:
- `redirected_to_sberid`
- `handoffRequired = true`
- в UI всё ещё виден `Войти`
- агент дошёл до Sber ID / OTP / подтверждения

Ожидаемое поведение:
1. агент стартует handoff
2. человек подключается
3. человек вручную завершает auth-boundary шаг
4. агент делает `resume`
5. агент проверяет, исчез ли `Войти`, и продолжает сценарий

### Сценарий B — Payment boundary handoff

Триггеры:
- достигнут `payecom.ru`
- виден `Войти по Сбер ID`
- требуется ручной просмотр / ручной промежуточный шаг

Ожидаемое поведение:
1. агент стартует handoff
2. человек подключается к той же session
3. человек доходит до нужного безопасного подшага
4. агент делает `resume`
5. агент по-прежнему не нажимает финальный `Оплатить`, если нет отдельного явного запроса

---

## 5. CLI contract для MVP1

Минимальный handoff API:

### 5.1 Start
```bash
browser-platform handoff start --session <id> --json
```

Ожидаемый ответ:
```json
{
  "ok": true,
  "sessionId": "...",
  "handoff": {
    "active": true,
    "mode": "vnc",
    "connect": {
      "host": "127.0.0.1",
      "port": 5901,
      "url": null,
      "novncUrl": null
    },
    "reason": "auth_boundary",
    "startedAt": "2026-04-01T00:00:00Z"
  }
}
```

### 5.2 Status
```bash
browser-platform handoff status --session <id> --json
```

### 5.3 Resume / unlock
```bash
browser-platform handoff resume --session <id> --json
```

### 5.4 Stop / cleanup
```bash
browser-platform handoff stop --session <id> --json
```

---

## 6. Требования к безопасному поведению

### 6.1 Session ownership
Пока `handoff.active = true`:
- агент не делает `click/fill/press`
- runtime возвращает явный lock-state
- человек считается текущим оператором session

После `resume`:
- human backend либо останавливается, либо переводится в read-only / inactive state
- агент снова получает эксклюзивный control

### 6.2 Safe defaults
По умолчанию:
- VNC bind только на localhost
- noVNC bind только на localhost
- без автопубликации наружу
- без случайного проброса в интернет

### 6.3 Cleanup
После `handoff stop`:
- display backend завершается
- VNC/noVNC процесс завершается
- временные токены / connect metadata очищаются
- orphaned процессы не остаются висеть

### 6.4 Trace/privacy
В traces не должны попадать в явном виде:
- OTP коды
- пароли
- чувствительные form values
- секреты из auth/payment полей

---

## 7. Commit-by-commit план

## Commit 11 — Handoff state model + CLI contract

### Что сделать
- добавить `handoff` сущность в daemon/session state
- добавить CLI-команды:
  - `handoff start`
  - `handoff status`
  - `handoff resume`
  - `handoff stop`
- добавить JSON schema для handoff state
- зафиксировать причины handoff:
  - `auth_boundary`
  - `payment_boundary`
  - `manual_debug`
  - `unknown_ui_state`

### Артефакты
- `src/cli/commands/handoff.ts`
- `src/daemon/handoff-registry.ts` или аналог
- правки в session/daemon types
- docs/README updates

### Done when
- CLI и daemon формально умеют управлять handoff lifecycle
- состояние handoff видно через JSON без реального VNC backend

---

## Commit 12 — Local VNC backend v1

### Что сделать
- подключить минимальный локальный VNC backend
- поднять технический доступ к той же browser session
- daemon управляет lifecycle backend-процессов

### Предпочтительный подход
Сначала делать **VNC-first**, а не noVNC-first:
- raw VNC backend проще отладить
- сначала нужен реальный human control
- noVNC потом добавится как web-front

### Артефакты
- `src/handoff/vnc.ts` или аналог
- lifecycle hooks в daemon
- локальная документация по запуску

### Done when
- можно подключиться VNC-клиентом к живой browser session

---

## Commit 13 — noVNC access v1

### Что сделать
- поднять web-доступ поверх VNC
- вернуть в handoff status structured `novncUrl`
- описать безопасный локальный запуск

### Артефакты
- `src/handoff/novnc.ts` или аналог
- docs по noVNC запуску
- расширение handoff connect metadata

### Done when
- человек может открыть handoff-сессию обычной ссылкой в браузере

---

## Commit 14 — Safe handoff/resume flow

### Что сделать
- добавить session lock/unlock semantics
- запретить agent actions во время active handoff
- после `resume` делать обязательный post-handoff observe
- фиксировать, изменилась ли page signature / auth state / payment boundary state

### Артефакты
- правки в run-step / action guard
- post-handoff validation helpers
- docs по safe resume

### Done when
- один и тот же LitRes сценарий можно безопасно прервать на handoff и продолжить

---

## Commit 15 — Trace integration + MVP1 acceptance

### Что сделать
- писать handoff lifecycle events в trace artifacts
- добавить acceptance docs
- подготовить минимум один успешный handoff scenario и один diagnostic scenario

### Trace events
- `handoff_started`
- `handoff_connect_info_issued`
- `handoff_human_active`
- `handoff_resumed`
- `handoff_stopped`

### Acceptance scenarios
1. LitRes auth boundary -> human handoff -> resume
2. LitRes payecom boundary -> human inspection step -> resume

### Done when
- MVP1 можно показать как working human-in-the-loop flow

---

## 8. Acceptance checklist

### Техническая приёмка
- [ ] handoff state живёт в daemon/session state
- [ ] CLI возвращает JSON для `handoff start/status/resume/stop`
- [ ] VNC backend поднимается и очищается без orphan processes
- [ ] noVNC link/endpoint поднимается и закрывается корректно
- [ ] traces содержат handoff lifecycle events

### Функциональная приёмка
- [ ] auth boundary можно передать человеку и потом продолжить
- [ ] payment boundary можно передать человеку и потом продолжить
- [ ] агент не вмешивается, пока handoff active
- [ ] после resume session остаётся той же
- [ ] финальные рискованные шаги по-прежнему не нажимаются автоматически

### Инженерная приёмка
- [ ] по trace видно, где именно начался и закончился handoff
- [ ] cleanup не оставляет зависших backend-процессов
- [ ] docs достаточно, чтобы развернуть локальный handoff без чтения кода

---

## 9. Порядок реализации

Если делать по здравому минимуму, порядок такой:

### MVP1-a
- Commit 11
- Commit 12

Это даст:
- formal handoff model
- реальный локальный VNC backend

### MVP1-b
- Commit 13
- Commit 14

Это даст:
- удобный web-доступ через noVNC
- безопасный resume flow

### MVP1-c
- Commit 15

Это даст:
- traces + acceptance
- формальное закрытие MVP1

---

## 10. Что важно не перепутать

VNC/noVNC не должен размыть уже работающую архитектуру MVP0.

Правильная модель:
- основной control path остаётся у агента
- human handoff включается только на boundary
- после boundary управление возвращается агенту
- traces продолжают быть источником диагностики и улучшения site packs

Иначе есть риск превратить browser-platform из управляемого agent runtime в просто remote desktop систему, а это не наша цель.
