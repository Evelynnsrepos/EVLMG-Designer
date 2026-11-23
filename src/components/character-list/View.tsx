import { Link2, Users } from 'lucide-react'
import { useCallback } from 'react'
import type { Character } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useProjectStore } from '@/core/state'
import { BehaviourSection } from '@/components/behaviour/BehaviourSection'
import {
  backlinksTo,
  DetailFrame,
  EntityList,
  EntityRefList,
  LINK_SUGGESTIONS,
  linkSearchText,
  LinksEditor,
  Section,
  type DetailContext,
  type ListText,
} from '@/shared/entityList'
import { characterActions as actions, goTo, openWiki } from './actions'

const TEXT: ListText = {
  one: 'character',
  many: 'characters',
  emptyBody: 'Add your first character: heroes, villains, shopkeepers, anyone.',
  newName: 'New character',
}

/** Character List (spec 8.11): characters, associations and links to other characters and towns. */
export default function View({ active }: PanelProps) {
  const collections = useProjectStore((s) => s.entities)
  const searchText = useCallback((c: Character) => linkSearchText(c.links, collections), [collections])
  const cardMeta = (c: Character) => {
    for (const l of c.links ?? []) {
      const town = l.targetType === 'town' ? collections.town.find((t) => t.id === l.targetId) : undefined
      if (town) return `${l.label || 'Linked to'} ${town.name}`
    }
    return ''
  }
  return (
    <EntityList
      type="character"
      active={active}
      actions={actions}
      text={TEXT}
      icon={Users}
      searchText={searchText}
      cardMeta={cardMeta}
      renderDetail={(c, ctx) => <CharacterDetail character={c} ctx={ctx} />}
    />
  )
}

function CharacterDetail({ character, ctx }: { character: Character; ctx: DetailContext }) {
  const collections = useProjectStore((s) => s.entities)
  const backlinks = backlinksTo(character.id, collections)
  return (
    <DetailFrame type="character" entity={character} actions={actions} ctx={ctx} text={TEXT} onOpenWiki={() => openWiki('character', character.id)}>
      <Section label="Links" icon={<Link2 size={13} aria-hidden />}>
        <LinksEditor
          selfId={character.id}
          links={character.links ?? []}
          onChange={(links, group) => actions.update(character.id, { links }, group ?? null)}
          targetTypes={['character', 'town']}
          suggestions={LINK_SUGGESTIONS.character}
          onNavigate={goTo}
        />
      </Section>
      <Section label="Linked from">
        <EntityRefList
          refs={backlinks.map((b) => ({ key: `${b.source.id}:${b.link.id}`, type: b.source.type, id: b.source.id, name: b.source.name, after: b.link.label }))}
          empty="No other character or town links here yet."
          onNavigate={goTo}
        />
      </Section>
      <BehaviourSection type="character" id={character.id} />
    </DetailFrame>
  )
}
