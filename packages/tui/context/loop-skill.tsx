/**
 * loop-skill.tsx - 技能状态管理
 *
 * 从 loop.tsx 抽取：
 * - activeSkill: 当前激活的技能
 * - activeSkillInstructions: 技能指令
 * - availableSkills: 可用技能列表
 * - skillSuggestIdx: 技能建议索引
 * - pendingSkillSuggestion: 待确认的 skill 建议
 * - listSkills / setActiveSkill / resolveSkillSuggestion
 */

import { createSignal } from "solid-js"
import { getSkillIndex } from "../../skills/loader"
import type { SkillIndex } from "../../skills/types"
import { matchSkills } from "../../skills/auto-suggest"

export interface SkillState {
  /** 当前激活的技能名称 */
  activeSkill: string | null
  /** 当前激活的技能指令 */
  activeSkillInstructions: string | null
  /** 可用技能列表 */
  availableSkills: SkillIndex[]
  /** 技能建议索引 */
  skillSuggestIdx: number
  /** 是否显示技能建议 */
  showSkillSuggestion: boolean
  /** 待确认的 skill 建议 */
  pendingSkillSuggestion: Array<{ name: string; description: string; triggerHints: string }> | null
}

export function createSkillState() {
  const [activeSkill, setActiveSkillSignal] = createSignal<string | null>(null)
  const [activeSkillInstructions, setActiveSkillInstructions] = createSignal<string | null>(null)
  const [availableSkills, setAvailableSkills] = createSignal<SkillIndex[]>([])
  const [skillSuggestIdx, setSkillSuggestIdx] = createSignal(0)
  const [showSkillSuggestion, setShowSkillSuggestion] = createSignal(false)
  const [pendingSkillSuggestion, setPendingSkillSuggestion] = createSignal<Array<{ name: string; description: string; triggerHints: string }> | null>(null)

  let skillSuggestResolve: ((value: boolean) => void) | null = null

  const listSkills = async (): Promise<string[]> => {
    const skills = await getSkillIndex(process.cwd())
    setAvailableSkills(skills)
    return skills.map(s => s.name)
  }

  const setActiveSkill = (name: string | null) => {
    setActiveSkillSignal(name)
    if (name) {
      const skill = availableSkills().find(s => s.name === name)
      setActiveSkillInstructions(skill?.description ?? null)
    } else {
      setActiveSkillInstructions(null)
    }
  }

  const resolveSkillSuggestion = (text: string, currentSkill: string | null): SkillIndex[] => {
    const skills = availableSkills()
    const suggestions = matchSkills(text, skills, currentSkill)
    if (suggestions.length > 0) {
      setShowSkillSuggestion(true)
      setSkillSuggestIdx(0)
    }
    return suggestions
  }

  const hideSkillSuggestion = () => {
    setShowSkillSuggestion(false)
    setSkillSuggestIdx(0)
  }

  const setSkillSuggestResolve = (fn: ((value: boolean) => void) | null) => {
    skillSuggestResolve = fn
  }

  const resolveSuggestion = (confirmed: boolean) => {
    if (skillSuggestResolve) {
      skillSuggestResolve(confirmed)
      skillSuggestResolve = null
    }
  }

  return {
    activeSkill,
    activeSkillInstructions,
    availableSkills,
    skillSuggestIdx,
    showSkillSuggestion,
    pendingSkillSuggestion,
    listSkills,
    setActiveSkill,
    resolveSkillSuggestion,
    hideSkillSuggestion,
    setSkillSuggestIdx,
    setPendingSkillSuggestion,
    setSkillSuggestResolve,
    resolveSuggestion,
  }
}

export type SkillStateReturn = ReturnType<typeof createSkillState>
