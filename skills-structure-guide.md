# Структура Skills для CLI Агентов

## Оглавление

- [Базовая структура репозитория](#базовая-структура-репозитория)
- [Анатомия Skill](#анатомия-skill)
- [Компоненты Skill](#компоненты-skill)
- [Принципы проектирования](#принципы-проектирования)
- [Workflow создания Skill](#workflow-создания-skill)
- [Утилиты и скрипты](#утилиты-и-скрипты)
- [Примеры использования](#примеры-использования)

---

## Базовая структура репозитория

```
/mnt/skills/
├── public/          # Публичные skills от Anthropic
│   ├── docx/
│   ├── pdf/
│   ├── pptx/
│   ├── xlsx/
│   └── ...
├── private/         # Приватные skills (если есть)
├── examples/        # Примеры для обучения
│   └── skill-creator/
└── user/            # Пользовательские skills
    └── your-skill/
```

---

## Анатомия Skill

### Минимальная структура

```
skill-name/
└── SKILL.md         # ОБЯЗАТЕЛЬНЫЙ файл
```

### Полная структура

```
skill-name/
├── SKILL.md         # ОБЯЗАТЕЛЬНЫЙ - основной файл с инструкциями
├── scripts/         # Опционально - исполняемый код
│   ├── script1.py
│   └── script2.sh
├── references/      # Опционально - документация для загрузки в контекст
│   ├── api_docs.md
│   └── schema.md
└── assets/          # Опционально - файлы для использования в output
    ├── template.html
    └── logo.png
```

---

## Компоненты Skill

### 1. SKILL.md (обязательный)

#### Структура файла

```markdown
---
name: skill-name
description: Подробное описание того, что делает skill и когда его использовать
---

# Название Skill

## Основные инструкции

Текст инструкций для Claude...

## Примеры использования

Конкретные примеры...
```

#### YAML Frontmatter

**Обязательные поля:**
- `name` - имя skill (kebab-case)
- `description` - **КРИТИЧЕСКИ ВАЖНО**: описание для триггеринга
  - Включай ЧТО делает skill
  - Включай КОГДА его использовать
  - Включай специфичные триггеры/контексты
  - Эта информация определяет, когда skill загрузится

**Опциональные поля:**
- `license` - информация о лицензии
- `compatibility` - требования к окружению (редко нужно)

#### Body (Markdown)

- Инструкции по использованию skill
- Загружается ТОЛЬКО после триггеринга
- Должен быть максимально кратким (<500 строк)
- Используй императивную форму глаголов

### 2. scripts/ (опционально)

**Назначение:**
- Исполняемый код для детерминированных операций
- Код, который постоянно переписывается одинаково

**Когда использовать:**
- Нужна надежность и детерминированность
- Одна и та же логика повторяется часто
- Сложные операции с файлами/API

**Примеры:**
```
scripts/
├── rotate_pdf.py        # Поворот PDF
├── compress_image.sh    # Сжатие изображений
└── parse_schema.py      # Парсинг схем БД
```

**Важно:**
- Скрипты могут выполняться БЕЗ загрузки в контекст
- Токен-эффективны
- Должны быть протестированы перед упаковкой

### 3. references/ (опционально)

**Назначение:**
- Документация и справочные материалы
- Загружается в контекст по мере необходимости

**Когда использовать:**
- Схемы БД, API спецификации
- Доменные знания, политики компании
- Детальные workflow guides
- Большие справочники

**Примеры:**
```
references/
├── database_schema.md   # Схема таблиц
├── api_reference.md     # API документация
├── policies.md          # Корпоративные политики
└── examples.md          # Примеры использования
```

**Best practices:**
- Для больших файлов (>10k слов) добавь grep паттерны в SKILL.md
- Не дублируй информацию между SKILL.md и references
- Детали в references, процедуры в SKILL.md

### 4. assets/ (опционально)

**Назначение:**
- Файлы НЕ для загрузки в контекст
- Используются в финальном output

**Когда использовать:**
- Шаблоны документов
- Изображения, иконки, шрифты
- Boilerplate код
- Sample документы для копирования/модификации

**Примеры:**
```
assets/
├── logo.png                    # Брендовые ресурсы
├── template.pptx               # Шаблон презентации
├── frontend-starter/           # Boilerplate проекта
│   ├── index.html
│   ├── style.css
│   └── app.js
└── font.ttf                    # Шрифты
```

---

## Принципы проектирования

### 1. Краткость - ключ к успеху

**Контекстное окно - общий ресурс:**
- System prompt
- История разговора
- Метаданные других Skills
- Реальный запрос пользователя

**Дефолтное предположение: Claude уже умный**
- Добавляй только то, чего Claude не знает
- Спрашивай себя: "Это действительно нужно?"
- Предпочитай примеры вместо объяснений

### 2. Progressive Disclosure (прогрессивная загрузка)

**Три уровня:**

1. **Метаданные** (name + description) - всегда в контексте (~100 слов)
2. **SKILL.md body** - когда skill триггерится (<5k слов)
3. **Bundled resources** - по мере необходимости (неограниченно)

**Паттерны разделения:**

```markdown
# Основной SKILL.md (краткий)

## Быстрый старт
[основной пример]

## Расширенные возможности
- **Feature A**: см. [FEATURE_A.md](references/FEATURE_A.md)
- **Feature B**: см. [FEATURE_B.md](references/FEATURE_B.md)
```

### 3. Степени свободы

**Высокая свобода (текстовые инструкции):**
- Множество валидных подходов
- Решения зависят от контекста
- Эвристики для направления

**Средняя свобода (псевдокод с параметрами):**
- Есть предпочтительный паттерн
- Допустимы вариации
- Конфигурация влияет на поведение

**Низкая свобода (конкретные скрипты):**
- Операции хрупкие и подвержены ошибкам
- Критична консистентность
- Должна соблюдаться конкретная последовательность

### 4. Что НЕ включать в Skill

**Запрещено создавать:**
- README.md
- INSTALLATION_GUIDE.md
- QUICK_REFERENCE.md
- CHANGELOG.md
- Любую вспомогательную документацию

**Skill должен содержать только:**
- Информацию для AI агента
- Процедурные знания
- Доменные детали

---

## Workflow создания Skill

### Шаг 1: Понимание через примеры

**Соберите конкретные примеры использования:**
- Как будет использоваться skill?
- Что должен говорить пользователь для триггера?
- Какие вариации использования?

**Вопросы для прояснения:**
- "Какую функциональность должен поддерживать skill?"
- "Можете дать примеры использования?"
- "Что еще может запросить пользователь?"

### Шаг 2: Планирование содержимого

**Анализ каждого примера:**
1. Как выполнить задачу с нуля?
2. Какие scripts/references/assets помогут?

**Примеры:**
- PDF rotation → `scripts/rotate_pdf.py`
- Frontend app → `assets/hello-world/` template
- BigQuery → `references/schema.md` с таблицами

### Шаг 3: Инициализация Skill

```bash
scripts/init_skill.py <skill-name> --path <output-directory>
```

**Скрипт создаст:**
- Директорию skill
- SKILL.md с шаблоном
- Примеры директорий (scripts/, references/, assets/)
- Примеры файлов для кастомизации

### Шаг 4: Редактирование Skill

**Последовательность:**
1. Создай reusable resources (scripts, references, assets)
2. Протестируй все скрипты
3. Удали ненужные примеры файлов
4. Обнови YAML frontmatter
5. Напиши body с инструкциями

**Стиль написания:**
- Используй императивную форму
- Будь кратким и конкретным
- Добавляй примеры, а не объяснения

### Шаг 5: Упаковка Skill

```bash
scripts/package_skill.py <path/to/skill-folder>
```

Или с указанием output директории:

```bash
scripts/package_skill.py <path/to/skill-folder> ./dist
```

**Скрипт:**
1. Валидирует skill автоматически
2. Проверяет YAML frontmatter
3. Проверяет naming conventions
4. Проверяет описание и структуру
5. Создает .skill файл (zip с расширением .skill)

**Если валидация провалится:**
- Исправь ошибки
- Запусти packaging снова

### Шаг 6: Итерация

**Цикл улучшения:**
1. Используй skill на реальных задачах
2. Замечай проблемы и неэффективности
3. Определи, что нужно обновить
4. Внеси изменения
5. Протестируй снова

---

## Утилиты и скрипты

### Доступные команды

```bash
# Создать новый skill
scripts/init_skill.py <skill-name> --path <output-directory>

# Упаковать skill в .skill файл
scripts/package_skill.py <path/to/skill-folder>

# С указанием output директории
scripts/package_skill.py <path/to/skill-folder> ./dist
```

### Валидация при упаковке

**Проверяется:**
- Формат YAML frontmatter
- Обязательные поля (name, description)
- Naming conventions
- Структура директорий
- Качество description
- Организация файлов
- Ссылки на ресурсы

---

## Примеры использования

### Пример 1: PDF Processing Skill

```
pdf-editor/
├── SKILL.md
├── scripts/
│   ├── rotate_pdf.py
│   ├── merge_pdf.py
│   └── split_pdf.py
└── references/
    └── pdf_operations.md
```

**SKILL.md:**
```markdown
---
name: pdf-editor
description: PDF manipulation including rotation, merging, splitting, and text extraction. Use when user needs to modify, process, or analyze PDF files.
---

# PDF Editor

## Quick Start

Rotate PDF:
```python
from scripts.rotate_pdf import rotate
rotate('input.pdf', 'output.pdf', 90)
```

## Advanced Operations

See [pdf_operations.md](references/pdf_operations.md) for:
- Merging multiple PDFs
- Splitting by page ranges
- Text extraction methods
```

### Пример 2: Frontend Boilerplate Skill

```
frontend-starter/
├── SKILL.md
└── assets/
    ├── vanilla-js/
    │   ├── index.html
    │   ├── style.css
    │   └── app.js
    └── react/
        ├── package.json
        ├── src/
        └── public/
```

**SKILL.md:**
```markdown
---
name: frontend-starter
description: Frontend application boilerplate with vanilla JS and React templates. Use when user asks to create a new web app, dashboard, or interactive webpage.
---

# Frontend Starter

## Usage

Copy appropriate template:

**Vanilla JS:**
```bash
cp -r assets/vanilla-js/* ./output/
```

**React:**
```bash
cp -r assets/react/* ./output/
npm install
```

## Templates Include

- Responsive layout
- Modern CSS reset
- Basic routing setup
- Common utilities
```

### Пример 3: Company Database Schema Skill

```
company-db/
├── SKILL.md
└── references/
    ├── tables.md
    ├── relationships.md
    └── examples.sql
```

**SKILL.md:**
```markdown
---
name: company-db
description: Company database schema documentation for writing queries and understanding data relationships. Use when user asks about database structure, table schemas, or how to query company data.
---

# Company Database

## Schema Overview

For complete table definitions, see [tables.md](references/tables.md).

For relationship diagrams, see [relationships.md](references/relationships.md).

## Common Queries

See [examples.sql](references/examples.sql) for:
- User analytics
- Sales reports
- Inventory management
```

---

## Best Practices

### ✅ DO

- Держи SKILL.md кратким (<500 строк)
- Используй progressive disclosure
- Тестируй скрипты перед упаковкой
- Пиши description с фокусом на триггеры
- Используй императивную форму
- Добавляй конкретные примеры
- Разделяй concerns (scripts/references/assets)

### ❌ DON'T

- Не создавай вспомогательную документацию
- Не дублируй информацию
- Не объясняй очевидное
- Не делай SKILL.md слишком длинным
- Не забывай про Progressive Disclosure
- Не упаковывай без тестирования скриптов
- Не пиши "когда использовать" в body (только в description)

---

## Troubleshooting

### Skill не триггерится

**Проблема:** Skill не загружается при нужных запросах

**Решение:**
- Улучши `description` в YAML frontmatter
- Добавь больше триггер-контекстов
- Укажи конкретные use cases
- Проверь, что description в frontmatter, а не в body

### Слишком большой SKILL.md

**Проблема:** SKILL.md превышает 500 строк

**Решение:**
- Вынеси детали в references/
- Используй progressive disclosure паттерн
- Оставь только core workflow в SKILL.md
- Добавь ссылки на reference файлы

### Скрипты не работают

**Проблема:** Ошибки при выполнении scripts/

**Решение:**
- Протестируй каждый скрипт отдельно
- Проверь dependencies
- Убедись в корректных путях
- Добавь error handling

### Валидация не проходит

**Проблема:** package_skill.py выдает ошибки

**Решение:**
- Проверь формат YAML frontmatter
- Убедись в наличии name и description
- Проверь naming conventions (kebab-case)
- Удали лишние файлы (README.md и т.д.)

---

## Дополнительные ресурсы

### Полезные reference файлы

Если создаешь skill со сложными workflows или специфичными паттернами, изучи:

- `/mnt/skills/examples/skill-creator/references/workflows.md` - паттерны для multi-step процессов
- `/mnt/skills/examples/skill-creator/references/output-patterns.md` - паттерны для форматов output и стандартов качества

### Расположение утилит

```
/mnt/skills/scripts/
├── init_skill.py      # Создание нового skill
└── package_skill.py   # Упаковка skill
```

---

## Заключение

Skills - это модульные пакеты для расширения возможностей Claude через:
- Специализированные workflows
- Интеграции с инструментами
- Доменную экспертизу
- Reusable ресурсы

**Ключевые принципы:**
1. Краткость критична
2. Progressive disclosure обязательна
3. Claude уже умный - добавляй только уникальное
4. Тестируй перед упаковкой
5. Итерируй на реальных задачах
