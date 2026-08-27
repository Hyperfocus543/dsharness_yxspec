// 驾驶舱卡片门控提示条（从 StageNode 拆出）
// 门控三态：blocked=真阻塞（上游未完成）、pending=待补产物、ok=产物齐备可 review。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。

import React from 'react';
import type { StageStatus } from '../../data/types';
import { renderInline } from '../../utils/markdown';
import { Icon } from '../ui';
import { I } from '../ui/icons';

interface StageGateBarProps {
  status: StageStatus;
  /** 被阻塞时可跳去第一个未完成的上游（仅真阻塞时给点击） */
  gateUpstreams: string[];
  onUpstreamClick: (token: string) => void;
}

/** 卡片底部门控提示条：三态区分（blocked 红警告 / pending 琥珀待补 / ok 绿正向），
    避免把"产物已存在可进 review"这类正向提示误渲染成红色警告 */
export const StageGateBar: React.FC<StageGateBarProps> = ({
  status,
  gateUpstreams,
  onUpstreamClick,
}) => {
  const gateState = status.gate_state;

  // 门控拦截条可点击：跳到被阻塞的上游阶段（打开对应产物抽屉）；无上游则纯提示，点击无效果
  const handleGateClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (gateUpstreams.length > 0) onUpstreamClick(gateUpstreams[0]);
  };

  return (
    <>
      {status.gate_message && gateState && (
        <div
          className={`mt-2 w-full flex items-center gap-1 min-w-0 text-xs leading-tight rounded px-1.5 py-1 ${
            gateState === 'blocked'
              ? 'text-red-700 bg-red-50 border border-red-200 cursor-pointer hover:bg-red-100 hover:border-red-300 transition-all active:scale-[0.98]'
              : gateState === 'pending'
                ? 'text-amber-700 bg-amber-50 border border-amber-200'
                : 'text-sage-700 bg-sage-50 border border-sage-200'
          }`}
          title={
            gateState === 'blocked'
              ? `点击查看上游阻塞（${gateUpstreams.join('、')}）`
              : status.gate_message
          }
          onClick={handleGateClick}
        >
          <span className="shrink-0">
            <Icon
              name={gateState === 'blocked' ? I.warn : I.check}
              size={11}
              weight="fill"
            />
          </span>
          <span className="flex-1 min-w-0 break-words">{renderInline(status.gate_message)}</span>
          {gateUpstreams.length > 0 && (
            <Icon name={I.arrowRight} size={10} weight="bold" className="shrink-0" />
          )}
        </div>
      )}
    </>
  );
};
