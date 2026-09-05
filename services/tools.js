// services/tools.js
// Anthropic Messages API의 tools 파라미터 형식. 각 name은 toolExecutors.js의
// 함수 이름과 1:1로 매칭됩니다 (chat.js의 dispatch 테이블에서 사용).

const tools = [
  {
    name: 'find_tasks',
    description:
      '제목 키워드로 기존 task를 검색합니다. 재배치/재분류/스케줄링 전에 정확한 task_id를 알아내기 위해 사용하세요.',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'task 제목에 포함된 검색어' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'create_category',
    description:
      '유저의 카테고리 목록에 새 카테고리를 만듭니다. 색상은 자동으로 배정되니 파라미터로 넘기지 마세요.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        parent_id: { type: 'integer', description: '서브카테고리면 상위 카테고리 id' },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_task',
    description: '새 할일을 만듭니다.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        category_id: { type: 'integer', description: '기존 카테고리 id (알고 있으면)' },
        category_name: { type: 'string', description: 'id를 모를 때 이름으로. 매칭 안 되면 새로 생성됨' },
        memo: { type: 'string' },
        due_date: { type: 'string', description: "'YYYY-MM-DD' 형식, 유저가 마감일을 언급했을 때만" },
        estimated_minutes: { type: 'integer' },
      },
      required: ['title'],
    },
  },
  {
    name: 'classify_priority',
    description:
      '방금 만들었거나 find_tasks로 찾은 task의 긴급도/중요도를 판단해서 저장합니다. 호출 즉시 반영되니, 유저에게는 그 다음에 확인 멘트만 하세요.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer' },
        ai_urgency: { type: 'number', description: '0.0 ~ 1.0' },
        ai_importance: { type: 'number', description: '0.0 ~ 1.0' },
        ai_reasoning: { type: 'string' },
      },
      required: ['task_id', 'ai_urgency', 'ai_importance', 'ai_reasoning'],
    },
  },
  {
    name: 'schedule_task',
    description: 'task 하나에 실제 시간을 배정합니다.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer' },
        start_at: { type: 'string', description: 'UTC ISO 8601' },
        end_at: { type: 'string', description: 'UTC ISO 8601' },
      },
      required: ['task_id', 'start_at', 'end_at'],
    },
  },
  {
    name: 'schedule_tasks_batch',
    description: '여러 task를 한 번에 스케줄링합니다. 2개 이상을 동시에 배정할 땐 반드시 이 함수를 쓰세요.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              task_id: { type: 'integer' },
              start_at: { type: 'string' },
              end_at: { type: 'string' },
            },
            required: ['task_id', 'start_at', 'end_at'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'reschedule_task',
    description: '이미 배정된 일정의 시간을 옮깁니다. 유저의 명시적 요청이 있을 때 즉시 반영하세요.',
    input_schema: {
      type: 'object',
      properties: {
        schedule_id: { type: 'integer' },
        start_at: { type: 'string' },
        end_at: { type: 'string' },
      },
      required: ['schedule_id', 'start_at', 'end_at'],
    },
  },
  {
    name: 'log_energy',
    description: '유저가 언급한 컨디션/에너지 상태를 기록합니다.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: "'YYYY-MM-DD'" },
        time_slot: { type: 'string', description: "1시간 단위, 예: '09:00-10:00'" },
        energy_level: { type: 'integer', description: '1~5' },
      },
      required: ['date', 'time_slot', 'energy_level'],
    },
  },
  {
    name: 'create_followup_flag',
    description:
      '발표, 면접, 시험처럼 유의미한 이벤트에만 선별적으로 사후 언급 플래그를 답니다. 일상 루틴성 task에는 사용하지 마세요.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer' },
        event_date: { type: 'string', description: "'YYYY-MM-DD'" },
      },
      required: ['task_id', 'event_date'],
    },
  },
  {
    name: 'complete_task',
    description: '유저가 "이거 했어", "완료했어" 처럼 task를 끝냈다고 말하면 호출해서 완료 처리합니다.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'update_task',
    description:
      '기존 task의 제목/메모/마감일/카테고리/예상 소요시간을 수정합니다. 넘긴 필드만 바뀝니다. task_id는 find_tasks로 먼저 찾으세요.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer' },
        title: { type: 'string' },
        memo: { type: 'string' },
        due_date: { type: 'string', description: "'YYYY-MM-DD'" },
        category_id: { type: 'integer' },
        estimated_minutes: { type: 'integer' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'delete_task',
    description: '유저가 명시적으로 삭제를 요청한 task를 삭제(soft delete)합니다.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'find_schedules',
    description:
      '"내일 일정 뭐있어", "이번 주에 뭐 있지" 처럼 특정 날짜/기간에 배정된 일정을 조회합니다. reschedule_task를 쓰기 전에 schedule_id를 모르면 먼저 이걸로 찾으세요.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: "단일 날짜 조회. 'YYYY-MM-DD'" },
        start_date: { type: 'string', description: '기간 조회 시작일 (date 대신 사용)' },
        end_date: { type: 'string', description: '기간 조회 종료일 (date 대신 사용)' },
      },
    },
  },
  {
    name: 'present_choices',
    description:
      '유저에게 버튼으로 고를 수 있는 선택지를 제시합니다. DB에 아무 영향도 주지 않습니다 - 확인/분기가 필요한 순간에만 사용하세요 (예: 여러 시간대 옵션 중 선택, "이대로 진행할까요?" 확인). 이 함수를 호출하면 그 턴에서 다른 함수는 실행되지 않으니, 같은 응답에서 실제 작업(schedule_task 등)과 함께 호출하지 마세요.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '선택지와 함께 보여줄 질문/설명 문구' },
        options: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 4,
          description: '유저가 누르면 그 텍스트가 그대로 다음 유저 메시지로 전송됩니다.',
        },
      },
      required: ['prompt', 'options'],
    },
  },
];

module.exports = { tools };
