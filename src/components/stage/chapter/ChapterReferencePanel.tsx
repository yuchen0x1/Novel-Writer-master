import { useLocaleStore } from '../../../stores/locale-store'
import type { BlueprintData } from '../../../../electron/repositories/blueprint-repository'
import type { SceneCard } from '../../../shared/scene-cards'

/**
 * 分屏对照的左栏：写作时钉住的参考信息（本章蓝图要点 + 场景卡）。
 * 纯展示，不产生任何写操作；空间不足时内容自身滚动。
 */
export default function ChapterReferencePanel({ blueprint, scenes }: {
  blueprint: BlueprintData | null
  scenes: readonly SceneCard[]
}) {
  const text = useLocaleStore(s => s.text)
  const hasBlueprint = Boolean(blueprint && (blueprint.purpose?.trim() || blueprint.keyEvents?.trim()
    || blueprint.suspenseHook?.trim() || blueprint.characters?.length))
  return (
    <aside className="stage-ch-refpanel" aria-label={text('写作参考（本章蓝图与场景卡）', 'Writing reference (chapter blueprint and scene cards)')}>
      <div className="stage-ch-refpanel-scroll">
        {hasBlueprint && (
          <section className="stage-ch-refsection">
            <h3 className="stage-ch-refheading">{text('本章蓝图', 'Chapter blueprint')}</h3>
            {blueprint!.purpose?.trim() && (
              <p className="stage-ch-refitem">
                <span className="stage-ch-reflabel">{text('目标', 'Goal')}</span>
                {blueprint!.purpose.trim()}
              </p>
            )}
            {blueprint!.keyEvents?.trim() && (
              <p className="stage-ch-refitem">
                <span className="stage-ch-reflabel">{text('关键事件', 'Key events')}</span>
                {blueprint!.keyEvents.trim()}
              </p>
            )}
            {blueprint!.suspenseHook?.trim() && (
              <p className="stage-ch-refitem">
                <span className="stage-ch-reflabel">{text('悬念钩子', 'Hook')}</span>
                {blueprint!.suspenseHook.trim()}
              </p>
            )}
            {blueprint!.characters?.length > 0 && (
              <p className="stage-ch-refitem">
                <span className="stage-ch-reflabel">{text('出场人物', 'Cast')}</span>
                {blueprint!.characters.join(text('、', ', '))}
              </p>
            )}
          </section>
        )}
        {scenes.length > 0 && (
          <section className="stage-ch-refsection">
            <h3 className="stage-ch-refheading">{text('场景卡', 'Scene cards')}</h3>
            {scenes.map(scene => (
              <div key={scene.id} className="stage-ch-refscene">
                <p className="stage-ch-refscene-title">{scene.title}</p>
                <dl className="stage-ch-refscene-facts">
                  {scene.location?.trim() && (
                    <div><dt>{text('地点', 'Place')}</dt><dd>{scene.location.trim()}</dd></div>
                  )}
                  {scene.storyTime?.trim() && (
                    <div><dt>{text('时间', 'Time')}</dt><dd>{scene.storyTime.trim()}</dd></div>
                  )}
                  {scene.participants?.length > 0 && (
                    <div><dt>{text('人物', 'Cast')}</dt><dd>{scene.participants.join(text('、', ', '))}</dd></div>
                  )}
                  {scene.goal?.trim() && (
                    <div><dt>{text('目标', 'Goal')}</dt><dd>{scene.goal.trim()}</dd></div>
                  )}
                  {scene.conflict?.trim() && (
                    <div><dt>{text('冲突', 'Conflict')}</dt><dd>{scene.conflict.trim()}</dd></div>
                  )}
                  {scene.transition?.trim() && (
                    <div><dt>{text('转场', 'Transition')}</dt><dd>{scene.transition.trim()}</dd></div>
                  )}
                </dl>
              </div>
            ))}
          </section>
        )}
        {!hasBlueprint && scenes.length === 0 && (
          <p className="stage-ch-refempty">{text(
            '本章还没有蓝图或场景卡；先到「蓝图」页生成，这里会钉住它们供写作时对照。',
            'No blueprint or scene cards for this chapter yet. Generate them on the Blueprint page and they will be pinned here while you write.',
          )}</p>
        )}
      </div>
    </aside>
  )
}
