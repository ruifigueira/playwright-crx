/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { BrowserContext, Page } from 'playwright-core';
import type { TestInfo } from '@playwright/test';
import { test, expect } from './crxRecorderTest';
import {
  attachRecorderEvidence,
  beginNewFlowFromLibraryLikeUser,
  createRepeatSegmentLikeUser,
  exportBusinessFlowJsonLikeUser,
  fillFlowMetaLikeUser,
  humanClick,
  humanClickUntil,
  humanType,
  selectAntdCascaderPathLikeUser,
  selectAntdOptionLikeUser,
  selectAntdTreeNodeLikeUser,
  visibleStepTexts,
} from './humanLike';

test.describe.configure({ mode: 'serial' });

test('human-like recorder preserves nth for duplicate test id save button @human-smoke', async ({ page, attachRecorder, baseURL }, testInfo) => {
  test.setTimeout(120_000);

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept('5') : dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', '重复 test id 保存按钮');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'AntD Pro');
  await fillFlowMetaLikeUser(recorderPage, '模块', '站点配置');
  await fillFlowMetaLikeUser(recorderPage, '页面', '全局配置');
  await fillFlowMetaLikeUser(recorderPage, '角色', 'admin');
  await humanClick(recorderPage.getByRole('button', { name: '创建并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-form-fields.html?duplicateSaveButton=1`);
  await expect(page.getByText('地址池与端口池')).toBeVisible();
  await expect(page.getByTestId('site-save-button')).toHaveCount(2);

  await humanClick(page.getByTestId('site-save-button').nth(1));
  await expect(page.getByText('配置已保存')).toBeVisible();
  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 25_000 }).toContain('site-save-button');

  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

  const flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  await attachRecorderEvidence(testInfo, page, recorderPage, flow);
  const saveStep = flow.steps.find((step: any) => step.target?.testId === 'site-save-button');
  expect(saveStep?.target?.locatorHint?.pageCount).toBe(2);
  expect(saveStep?.target?.locatorHint?.pageIndex).toBe(1);
  expect(flow.artifacts.playwrightCode).toContain('page.getByTestId("site-save-button").nth(1).click();');
  expect(flow.artifacts.playwrightCode).not.toContain('page.getByTestId("site-save-button").click();');

  await humanClick(recorderPage.getByRole('button', { name: 'Playwright 代码' }));

  const runtimeLogBaseline = await runtimeDiagnostics(recorderPage);
  await humanClick(recorderPage.getByTitle('Resume (F8)'));
  await expect.poll(async () => {
    const logs = await runtimeDiagnosticsAfter(recorderPage, runtimeLogBaseline);
    return logs.some(log => log.type === 'runtime.playback-stop');
  }, { timeout: 30_000 }).toBeTruthy();
  const replayRuntimeLogs = await runtimeDiagnosticsAfter(recorderPage, runtimeLogBaseline);
  expect(replayRuntimeLogs.filter(log => log.type.includes('error') || log.level === 'warn')).toEqual([]);
});

test('human-like runtime replay skips redundant IPv4 field focus click @human-smoke', async ({ page, attachRecorder, baseURL }) => {
  test.setTimeout(120_000);
  const strictHumanOptions = { allowFallback: false as const };

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept('5') : dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', '地址池 runtime replay');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'AntD Pro');
  await fillFlowMetaLikeUser(recorderPage, '模块', '站点配置');
  await fillFlowMetaLikeUser(recorderPage, '页面', '全局配置');
  await fillFlowMetaLikeUser(recorderPage, '角色', 'admin');
  await humanClick(recorderPage.getByRole('button', { name: '创建并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-form-fields.html`);
  await expect(page.getByText('地址池与端口池')).toBeVisible();

  const ipv4Dialog = page.locator('.ant-modal, .ant-drawer, [role="dialog"]').filter({ hasText: '新建IPv4地址池' });
  await humanClickUntil(
      page.getByTestId('site-ip-address-pool-create-button'),
      async () => await ipv4Dialog.isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 500, ...strictHumanOptions },
  );
  await expect(ipv4Dialog).toBeVisible({ timeout: 10_000 });

  await humanType(page.getByPlaceholder('地址池名称'), 'runtime-pool');
  const wanTrigger = ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, wanTrigger, 'xtest16:WAN1', { searchText: 'xtest16', ...strictHumanOptions });
  await expect(ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' })).toContainText('xtest16:WAN1');

  await humanType(page.getByRole('textbox', { name: '开始地址，例如：' }), '1.1.1.1');
  await humanType(page.getByRole('textbox', { name: '结束地址，例如：' }), '2.2.2.2');
  await humanClickUntil(
      ipv4Dialog.getByRole('button', { name: '确 定' }),
      async () => !await ipv4Dialog.isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 800, ...strictHumanOptions },
  );
  await expect(page.getByRole('row', { name: /runtime-pool.*xtest16:WAN1.*1\.1\.1\.1.*2\.2\.2\.2/ })).toBeVisible({ timeout: 10_000 });
  await humanClick(page.getByTestId('site-save-button'));
  await expect(page.getByText('配置已保存')).toBeVisible();

  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 25_000 }).toContain('runtime-pool');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('1.1.1.1');
  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

  await page.goto(`${baseURL}/antd-pro-form-fields.html`);
  await expect(page.getByText('地址池与端口池')).toBeVisible();
  await humanClick(recorderPage.getByRole('button', { name: 'Playwright 代码' }));
  const runtimeLogBaseline = await runtimeDiagnostics(recorderPage);
  await humanClick(recorderPage.getByTitle('Resume (F8)'));
  await expect.poll(async () => {
    const logs = await runtimeDiagnosticsAfter(recorderPage, runtimeLogBaseline);
    return logs.some(log => log.type === 'runtime.playback-stop');
  }, { timeout: 30_000 }).toBeTruthy();
  const replayRuntimeLogs = await runtimeDiagnosticsAfter(recorderPage, runtimeLogBaseline);
  expect(replayRuntimeLogs.filter(log => log.type.includes('error') || log.level === 'warn')).toEqual([]);
  await expect(page.getByRole('row', { name: /runtime-pool.*xtest16:WAN1.*1\.1\.1\.1.*2\.2\.2\.2/ })).toBeVisible({ timeout: 10_000 });
});

test('human-like runtime replay supports wait inserted between address and port pools @human-smoke', async ({ page, attachRecorder, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const strictHumanOptions = { allowFallback: false as const };

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept('5') : dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', '地址池端口池 wait replay');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'AntD Pro');
  await fillFlowMetaLikeUser(recorderPage, '模块', '站点配置');
  await fillFlowMetaLikeUser(recorderPage, '页面', '全局配置');
  await fillFlowMetaLikeUser(recorderPage, '角色', 'admin');
  await humanClick(recorderPage.getByRole('button', { name: '创建并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-form-fields.html?duplicateSaveButton=1`);
  await expect(page.getByText('地址池与端口池')).toBeVisible();
  await expect(page.getByTestId('site-save-button')).toHaveCount(2);

  const ipv4Dialog = page.locator('.ant-modal, .ant-drawer, [role="dialog"]').filter({ hasText: '新建IPv4地址池' });
  await humanClickUntil(
      page.getByTestId('site-ip-address-pool-create-button'),
      async () => await ipv4Dialog.isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 500, ...strictHumanOptions },
  );
  await expect(ipv4Dialog).toBeVisible({ timeout: 10_000 });
  await humanType(ipv4Dialog.getByPlaceholder('地址池名称'), 'test1');
  const wanTrigger = ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, wanTrigger, 'xtest16:WAN1', { searchText: 'xtest16', ...strictHumanOptions });
  await expect(ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' })).toContainText('xtest16:WAN1');
  await humanType(page.getByRole('textbox', { name: '开始地址，例如：' }), '1.1.1.1');
  await humanType(page.getByRole('textbox', { name: '结束地址，例如：' }), '2.2.2.2');
  await humanClickUntil(
      ipv4Dialog.getByRole('button', { name: '确 定' }),
      async () => !await ipv4Dialog.isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 800, ...strictHumanOptions },
  );
  await expect(page.getByRole('row', { name: /test1.*xtest16:WAN1.*1\.1\.1\.1.*2\.2\.2\.2/ })).toBeVisible({ timeout: 10_000 });
  await humanClick(page.getByTestId('site-save-button').nth(1));
  await expect(page.getByText('配置已保存')).toBeVisible();
  await humanClick(page.getByTestId('site-global-ip-pools-section'));

  const portDialog = page.locator('.ant-modal, .ant-drawer, [role="dialog"]').filter({ hasText: '新建IP端口地址池' });
  await humanClickUntil(
      page.getByTestId('site-ip-port-pool-create-button'),
      async () => await portDialog.isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 500, ...strictHumanOptions },
  );
  await expect(portDialog).toBeVisible({ timeout: 10_000 });
  await humanType(portDialog.getByPlaceholder('地址池名称'), 'test12');
  const addressPoolTrigger = portDialog.locator('.ant-form-item').filter({ hasText: 'IP地址池' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, addressPoolTrigger, 'test1 共享 1.1.1.1--2.2.2.2', { searchText: 'test1', ...strictHumanOptions });
  await expect(portDialog.locator('.ant-form-item').filter({ hasText: 'IP地址池' })).toContainText('test1');
  await expect(portDialog.locator('.ant-form-item').filter({ hasText: 'IP地址池' })).toContainText('共享');
  await expect(portDialog.locator('.ant-form-item').filter({ hasText: 'IP地址池' })).toContainText('1.1.1.1--2.2.2.2');
  await humanType(page.getByRole('textbox', { name: 'IP/前缀，例如：192.168.1.1或192.168.' }), '1.1.1.1');
  await humanType(page.getByRole('textbox', { name: '端口，例如：80,100-' }), '80');
  const vrfTrigger = portDialog.locator('.ant-form-item').filter({ hasText: '关联VRF' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, vrfTrigger, 'default', strictHumanOptions);
  await expect(portDialog.locator('.ant-form-item').filter({ hasText: '关联VRF' })).toContainText('default');
  await humanClickUntil(
      portDialog.getByRole('button', { name: '确 定' }),
      async () => !await portDialog.isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 800, ...strictHumanOptions },
  );
  await expect(page.getByRole('row', { name: /test12.*test1 共享 1\.1\.1\.1--2\.2\.2\.2.*1\.1\.1\.1:80.*default/ })).toBeVisible({ timeout: 10_000 });
  await humanClick(page.getByTestId('site-save-button').nth(1));

  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 25_000 }).toContain('site-ip-port-pool-create-button');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('default');
  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

  let flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  expect(flow.steps.some((step: any) => step.target?.testId === 'site-global-ip-pools-section')).toBeFalsy();
  expect(flow.artifacts.playwrightCode).not.toContain('site-global-ip-pools-section');
  const firstSaveStepId = requiredStepId(flow, (step: any) => step.target?.testId === 'site-save-button', 'first save config step');
  await openInsertMenuAfterStepLikeUser(recorderPage, firstSaveStepId);
  await humanClick(recorderPage.getByRole('button', { name: '插入等待' }));
  await expect(recorderPage.locator('.review-step-list')).toContainText('等待');

  flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  await attachRecorderEvidence(testInfo, page, recorderPage, flow);
  const waitStepId = requiredStepId(flow, (step: any) => step.action === 'wait', 'inserted wait step');
  expect(stepIndex(flow, waitStepId)).toBe(stepIndex(flow, firstSaveStepId) + 1);
  expect(flow.artifacts.playwrightCode).toContain('waitForTimeout(5000)');
  expect(flow.artifacts.playwrightCode).toContain('site-ip-port-pool-create-button');

  await page.goto(`${baseURL}/antd-pro-form-fields.html?duplicateSaveButton=1`);
  await expect(page.getByText('地址池与端口池')).toBeVisible();
  await humanClick(recorderPage.getByRole('button', { name: 'Playwright 代码' }));
  const runtimeLogBaseline = await runtimeDiagnostics(recorderPage);
  await humanClick(recorderPage.getByTitle('Resume (F8)'));
  await expect.poll(async () => {
    const logs = await runtimeDiagnosticsAfter(recorderPage, runtimeLogBaseline);
    return logs.some(log => log.type === 'runtime.playback-stop');
  }, { timeout: 60_000 }).toBeTruthy();
  const replayRuntimeLogs = await runtimeDiagnosticsAfter(recorderPage, runtimeLogBaseline);
  expect(replayRuntimeLogs.filter(log => log.type.includes('error') || log.level === 'warn')).toEqual([]);
  await expect(page.getByRole('row', { name: /test1.*test1 共享 1\.1\.1\.1--2\.2\.2\.2.*1\.1\.1\.1:80.*default/ })).toBeVisible({ timeout: 10_000 });
});

test('human-like records IPv4 pool repeat flow and replays generated code @human-smoke', async ({ context, page, attachRecorder, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const benchmarkCase = loadBenchmarkCase('recorder_intent_repeat.json');
  expect(benchmarkCase.name).toBe('recorder_ipv4_pool_step_intent_repeat_data');
  const strictHumanOptions = { allowFallback: false as const };

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', '地址池 human smoke');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'AntD Pro');
  await fillFlowMetaLikeUser(recorderPage, '模块', '站点配置');
  await fillFlowMetaLikeUser(recorderPage, '页面', '全局配置');
  await fillFlowMetaLikeUser(recorderPage, '角色', 'admin');
  await humanClick(recorderPage.getByRole('button', { name: '创建并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-form-fields.html`);
  await expect(page.getByText('地址池与端口池')).toBeVisible();

  await humanClick(page.getByTestId('site-ip-address-pool-create-button'));
  const ipv4Dialog = page.locator('.ant-modal, .ant-drawer, [role="dialog"]').filter({ hasText: '新建IPv4地址池' });
  await expect(ipv4Dialog).toBeVisible({ timeout: 10_000 });

  await humanType(page.getByPlaceholder('地址池名称'), 'test1');
  const wanTrigger = ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, wanTrigger, 'xtest16:WAN1', { searchText: 'xtest16', ...strictHumanOptions });
  await expect(ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' })).toContainText('xtest16:WAN1');

  await humanType(page.getByRole('textbox', { name: '开始地址，例如：' }), '1.1.1.1');
  await humanType(page.getByRole('textbox', { name: '结束地址，例如：' }), '2.2.2.2');
  await humanClickUntil(
      ipv4Dialog.getByRole('button', { name: '确 定' }),
      async () => !await ipv4Dialog.isVisible().catch(() => false),
      { attempts: 5, afterClickDelayMs: 800, ...strictHumanOptions },
  );
  await expect(page.getByRole('row', { name: /test1.*xtest16:WAN1.*1\.1\.1\.1.*2\.2\.2\.2/ })).toBeVisible({ timeout: 10_000 });
  await humanClick(page.getByTestId('site-save-button'));
  await expect(page.getByText('配置已保存')).toBeVisible();

  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 25_000 }).toContain('site-ip-address-pool-create-button');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('test1');
  await expect.poll(() => visibleStepTexts(recorderPage)).toMatch(/WAN口|选择一个WAN口|xtest16:WAN1/);

  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

  await createRepeatSegmentLikeUser(recorderPage, {
    fromStepText: 'site-ip-address-pool-create-button',
    toStepText: 'ipv4-address-pool-confirm',
    segmentName: '批量创建IPv4地址池',
  });

  const flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  await attachRecorderEvidence(testInfo, page, recorderPage, flow);

  expect(flow.flow.name).toBe('地址池 human smoke');
  expect(flow.repeatSegments?.[0]?.parameters.map((parameter: any) => parameter.variableName)).toEqual(expect.arrayContaining(['poolName', 'wanPort', 'startIp', 'endIp']));
  expect(flow.repeatSegments?.[0]?.stepIds).not.toContain(flow.steps.find((step: any) => step.target?.testId === 'site-save-button')?.id);
  expect(flow.artifacts.playwrightCode).toContain('for (const row of');
  expect(flow.artifacts.playwrightCode).toContain('xtest16:WAN1');
  expect(flow.artifacts.playwrightCode).not.toMatch(/getByRole\(["']combobox["'],\s*\{\s*name:\s*["']WAN口["']/);
  expect(flow.artifacts.playwrightCode).not.toContain('#rc_select_');

  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, testInfo);
});

test('case-driven human-like records user admin modal repeat flow and replays generated code @human-smoke', async ({ context, page, attachRecorder, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const benchmarkCase = loadBenchmarkCase('user_admin_repeat.json');
  expect(benchmarkCase.name).toBe('recorder_user_admin_modal_repeat');
  const strictHumanOptions = { allowFallback: false as const };

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', '用户管理 human smoke');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'AntD');
  await fillFlowMetaLikeUser(recorderPage, '模块', '系统管理');
  await fillFlowMetaLikeUser(recorderPage, '页面', '用户列表');
  await fillFlowMetaLikeUser(recorderPage, '角色', 'admin');
  await humanClick(recorderPage.getByRole('button', { name: '创建并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-users-real.html`);
  await expect(page.getByTestId('user-admin-card')).toContainText('用户管理');

  await humanClick(page.getByTestId('create-user-btn'));
  const userDialog = page.locator('.ant-modal, [role="dialog"]').filter({ hasText: '新建用户' });
  await expect(userDialog).toBeVisible({ timeout: 10_000 });

  const usernameInput = page.getByPlaceholder('请输入用户名');
  await humanType(usernameInput, 'alice.qa', { clear: true });
  await expect(usernameInput).toHaveValue('alice.qa');
  const roleTrigger = userDialog.locator('.ant-form-item').filter({ hasText: '角色' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, roleTrigger, '审计员', strictHumanOptions);
  await expect(userDialog.locator('.ant-form-item').filter({ hasText: '角色' })).toContainText('审计员');

  await humanClickUntil(
      userDialog.getByTestId('modal-confirm'),
      async () => !await userDialog.isVisible().catch(() => false),
      { ...strictHumanOptions },
  );
  await expect(userDialog).not.toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('row', { name: /alice\.qa.*审计员/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('保存成功：alice.qa')).toBeVisible();

  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 25_000 }).toContain('create-user-btn');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('alice.qa');
  await expect.poll(() => visibleStepTexts(recorderPage)).toMatch(/角色|审计员/);

  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

  await createRepeatSegmentLikeUser(recorderPage, {
    fromStepText: 'create-user-btn',
    toStepText: 'modal-confirm',
    segmentName: '批量新建用户',
    minSteps: benchmarkCase.repeat_segment.selected_step_ids.length,
    expectedDataText: /alice|test|审计员/,
  });

  const flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  await attachRecorderEvidence(testInfo, page, recorderPage, flow);

  expect(flow.flow.name).toBe('用户管理 human smoke');
  expect(flow.repeatSegments?.[0]?.parameters.map((parameter: any) => parameter.variableName)).toEqual(expect.arrayContaining(['username', 'role']));
  expect(flow.artifacts.playwrightCode).toContain('for (const row of');
  expect(flow.artifacts.playwrightCode).toContain('审计员');
  expect(flow.artifacts.playwrightCode).not.toContain('#rc_select_');

  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, testInfo);
});

test('case-driven human-like records network resource complex form repeat flow and replays generated code @human-smoke', async ({ context, page, attachRecorder, baseURL }, testInfo) => {
  test.setTimeout(240_000);
  const benchmarkCase = loadBenchmarkCase('network_resource_repeat.json');
  expect(benchmarkCase.name).toBe('recorder_network_resource_complex_repeat');
  const strictHumanOptions = { allowFallback: false as const };

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibraryLikeUser(recorderPage);
  await fillFlowMetaLikeUser(recorderPage, '流程名称', '网络资源 human smoke');
  await fillFlowMetaLikeUser(recorderPage, '应用', 'AntD Pro');
  await fillFlowMetaLikeUser(recorderPage, '模块', '站点配置');
  await fillFlowMetaLikeUser(recorderPage, '页面', '全局配置');
  await fillFlowMetaLikeUser(recorderPage, '角色', 'admin');
  await humanClick(recorderPage.getByRole('button', { name: '创建并开始录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-form-fields.html`);
  await expect(page.getByTestId('network-config-card')).toContainText('网络配置资源');

  await humanClick(page.getByTestId('network-resource-add'));
  const networkDialog = page.locator('.ant-modal, [role="dialog"]').filter({ hasText: '新建网络资源' });
  await expect(networkDialog).toBeVisible({ timeout: 10_000 });

  const resourceNameInput = page.getByPlaceholder('地址池名称');
  await humanType(resourceNameInput, 'res-web-01', { clear: true });
  await expect(resourceNameInput).toHaveValue('res-web-01');
  const wanTrigger = networkDialog.locator('.ant-form-item').filter({ hasText: 'WAN口' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, wanTrigger, 'edge-lab:WAN1', { searchText: 'edge-lab', ...strictHumanOptions });
  await expect(networkDialog.locator('.ant-form-item').filter({ hasText: 'WAN口' })).toContainText('edge-lab:WAN1');

  const vrfTrigger = networkDialog.locator('.ant-form-item').filter({ hasText: '关联VRF' }).locator('.ant-select-selector').first();
  await selectAntdOptionLikeUser(page, vrfTrigger, '生产VRF', strictHumanOptions);
  await expect(networkDialog.locator('.ant-form-item').filter({ hasText: '关联VRF' })).toContainText('生产VRF');

  await humanClick(networkDialog.getByText('开启代理ARP'));
  const healthUrl = page.getByPlaceholder('https://probe.example/health');
  const healthSwitch = networkDialog.getByTestId('network-resource-health-switch');
  for (let attempt = 0; attempt < 4 && !await healthUrl.isVisible().catch(() => false); attempt++) {
    await healthSwitch.click({ timeout: 10_000 });
    await page.waitForTimeout(300);
  }
  await expect(healthUrl).toBeVisible({ timeout: 10_000 });
  await humanType(healthUrl, 'https://probe.example/health', { clear: true, delayMs: 80 });
  await healthUrl.fill('https://probe.example/health');
  await expect(healthUrl).toHaveValue('https://probe.example/health');

  const scopeTrigger = page.getByTestId('network-resource-scope-tree').locator('.ant-select-selector').first();
  await selectAntdTreeNodeLikeUser(page, scopeTrigger, '华东生产区', strictHumanOptions);
  await expect(networkDialog.locator('.ant-form-item').filter({ hasText: '发布范围' })).toContainText('华东生产区');

  const egressTrigger = page.getByTestId('network-resource-egress-cascader').locator('.ant-select-selector, .ant-cascader-picker').first();
  await selectAntdCascaderPathLikeUser(page, egressTrigger, ['上海', '一号机房', 'NAT集群A'], strictHumanOptions);
  await expect(networkDialog.locator('.ant-form-item').filter({ hasText: '出口路径' })).toContainText('NAT集群A');

  const serviceInput = page.getByPlaceholder('服务名称');
  await humanType(serviceInput, 'web');
  await expect(serviceInput).toHaveValue('web');
  const listenPortInput = page.getByPlaceholder('监听端口');
  await humanType(listenPortInput, '443', { clear: true, delayMs: 120 });
  await expect(listenPortInput).toHaveValue('443');
  const remarkInput = page.getByPlaceholder('填写策略备注');
  await humanType(remarkInput, '生产访问策略', { clear: true, delayMs: 160 });
  await remarkInput.fill('生产访问策略');
  await expect(remarkInput).toHaveValue('生产访问策略');
  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 15_000 }).toContain('生产访问策略');

  const networkTable = page.getByTestId('network-resource-table');
  const networkSaveButton = networkDialog.locator('[data-testid="network-resource-save"]');
  await expect(networkSaveButton).toBeVisible();
  await expect(networkSaveButton).toBeEnabled();
  for (let attempt = 0; attempt < 4 && await networkDialog.isVisible().catch(() => false); attempt++) {
    try {
      await networkSaveButton.click({ timeout: 5_000 });
    } catch (error) {
      if (!await networkDialog.isVisible().catch(() => false))
        break;
      throw error;
    }
    await page.waitForTimeout(500);
  }
  await expect(networkDialog).toBeHidden({ timeout: 10_000 });
  await expect(networkTable).toContainText('res-web-01', { timeout: 10_000 });
  await expect(networkTable).toContainText('edge-lab:WAN1');
  await expect(networkTable).toContainText('华东生产区');
  await expect(networkTable).toContainText('NAT集群A');
  await expect(networkTable).toContainText('启用');
  await expect(networkTable).toContainText('web:443');
  await expect(networkTable).toContainText('生产访问策略');

  await expect.poll(() => visibleStepTexts(recorderPage), { timeout: 25_000 }).toContain('network-resource-add');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('res-web-01');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('edge-lab:WAN1');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('生产VRF');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('https://probe.example/health');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('华东生产区');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('NAT集群A');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('443');
  await expect.poll(() => visibleStepTexts(recorderPage)).toContain('生产访问策略');

  await humanClick(recorderPage.getByRole('button', { name: '停止录制' }));
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

  await createRepeatSegmentLikeUser(recorderPage, {
    fromStepText: 'network-resource-add',
    toStepText: 'network-resource-save',
    segmentName: '批量新建网络资源',
    minSteps: benchmarkCase.repeat_segment.selected_step_ids.length,
    expectedDataText: /res-web-01|edge-lab:WAN1|生产VRF|https:\/\/probe\.example\/health|web|生产访问策略/,
    requiredSelectedTexts: ['华东生产区', 'NAT集群A', 'https://probe.example/health', '生产访问策略'],
  });

  const flow = await exportBusinessFlowJsonLikeUser(recorderPage);
  await attachRecorderEvidence(testInfo, page, recorderPage, flow);

  expect(flow.flow.name).toBe('网络资源 human smoke');
  expect(flow.repeatSegments?.[0]?.parameters.map((parameter: any) => parameter.variableName)).toEqual(expect.arrayContaining(['resourceName', 'wanPort', 'vrf', 'scope', 'egressPath', 'serviceName', 'listenPort', 'remark']));
  expect(flow.artifacts.playwrightCode).toContain('for (const row of');
  expect(flow.artifacts.playwrightCode).toContain('edge-lab:WAN1');
  expect(flow.artifacts.playwrightCode).toContain('NAT集群A');
  expect(flow.artifacts.playwrightCode).toContain('https://probe.example/health');
  expect(flow.artifacts.playwrightCode).toContain('生产访问策略');
  expect(flow.artifacts.playwrightCode).not.toContain('#rc_select_');

  const networkReplayVerificationLines = [
    `const table = page.getByTestId("network-resource-table");`,
    `await expect(table).toContainText("res-web-01", { timeout: 10000 });`,
    `await expect(table).toContainText("edge-lab:WAN1");`,
    `await expect(table).toContainText("生产VRF");`,
    `await expect(table).toContainText("华东生产区");`,
    `await expect(table).toContainText("NAT集群A");`,
    `await expect(table).toContainText("web:443");`,
    `await expect(table).toContainText("生产访问策略");`,
  ];
  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, testInfo, async replayPage => {
    const table = replayPage.getByTestId('network-resource-table');
    await expect(table).toContainText('res-web-01', { timeout: 10_000 });
    await expect(table).toContainText('edge-lab:WAN1');
    await expect(table).toContainText('生产VRF');
    await expect(table).toContainText('华东生产区');
    await expect(table).toContainText('NAT集群A');
    await expect(table).toContainText('web:443');
    await expect(table).toContainText('生产访问策略');
  }, networkReplayVerificationLines);
});

function loadBenchmarkCase(fileName: string) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'benchmarks', 'agent_models', 'cases', fileName), 'utf8'));
}

type RuntimeDiagnostic = {
  id: number;
  type: string;
  level?: string;
  message?: string;
};

async function runtimeDiagnostics(page: Page): Promise<RuntimeDiagnostic[]> {
  return await page.evaluate(() => {
    const logs = (window as typeof window & { __playwrightCrxRecorderDiagnostics?: RuntimeDiagnostic[] }).__playwrightCrxRecorderDiagnostics ?? [];
    return logs.filter(log => log.type.startsWith('runtime.'));
  });
}

async function runtimeDiagnosticsAfter(page: Page, baseline: RuntimeDiagnostic[]) {
  const maxBaselineId = baseline.reduce((max, log) => Math.max(max, log.id), 0);
  return (await runtimeDiagnostics(page)).filter(log => log.id > maxBaselineId);
}

function requiredStepId(flow: any, predicate: (step: any) => boolean, description: string) {
  const step = flow.steps.find(predicate);
  if (!step)
    throw new Error(`Unable to find ${description} in exported flow: ${JSON.stringify(flow.steps.map((step: any) => ({ id: step.id, action: step.action, target: step.target, value: step.value })), null, 2)}`);
  return step.id;
}

function stepIndex(flow: any, stepId: string) {
  return flow.steps.findIndex((step: any) => step.id === stepId);
}

async function openInsertMenuAfterStepLikeUser(recorderPage: Page, stepId: string) {
  const row = recorderPage.locator('.review-step-row').filter({ hasText: stepId }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  const insertButton = row.locator('xpath=following-sibling::*[contains(@class, "review-insert-slot")][1]//button').first();
  await expect(insertButton).toBeVisible({ timeout: 10_000 });
  await humanClick(insertButton);
  await expect(recorderPage.locator('.review-insert-popover')).toBeVisible({ timeout: 10_000 });
}

async function replayGeneratedPlaywrightCode(context: BrowserContext, code: string, testInfo: TestInfo, verify?: (page: Page) => Promise<void>, standaloneVerificationLines: string[] = []) {
  const rawReplayDir = testInfo.outputPath('raw-generated-replay');
  fs.mkdirSync(rawReplayDir, { recursive: true });
  fs.writeFileSync(path.join(rawReplayDir, 'generated-before-inline.spec.ts'), code);

  const body = testBody(code);
  const replayPage = await context.newPage();
  try {
    const replay = new Function('page', 'expect', `return (async () => {\n${body}\n})();`);
    await replay(replayPage, expect);
    if (verify)
      await verify(replayPage);
  } finally {
    await replayPage.close();
  }
  runGeneratedPlaywrightSourceAsStandaloneSpec(code, testInfo, standaloneVerificationLines);
}

function appendReplayVerification(code: string, verificationLines: string[]) {
  if (!verificationLines.length)
    return code;
  const bodyEnd = code.lastIndexOf('\n});');
  if (bodyEnd < 0)
    throw new Error(`Unable to append generated replay verification:\n${code}`);
  return `${code.slice(0, bodyEnd)}\n\n  // business terminal-state verification added by the E2E harness\n  ${verificationLines.join('\n  ')}\n${code.slice(bodyEnd)}`;
}

function runGeneratedPlaywrightSourceAsStandaloneSpec(code: string, testInfo: TestInfo, verificationLines: string[] = []) {
  const rawReplayRoot = path.join(__dirname, '..', '.raw-generated-replay');
  fs.mkdirSync(rawReplayRoot, { recursive: true });
  const rawReplayDir = fs.mkdtempSync(path.join(rawReplayRoot, `${testInfo.workerIndex}-`));
  const specPath = path.join(rawReplayDir, 'generated-replay.spec.ts');
  const configPath = path.join(rawReplayDir, 'playwright.raw-replay.config.ts');
  const specSource = appendReplayVerification(code, verificationLines);
  fs.writeFileSync(specPath, specSource);
  fs.writeFileSync(configPath, [
    `import { defineConfig, devices } from '@playwright/test';`,
    `export default defineConfig({`,
    `  timeout: 120000,`,
    `  workers: 1,`,
    `  reporter: 'line',`,
    `  use: { ...devices['Desktop Chrome'], baseURL: ${JSON.stringify(rawReplayBaseURL())} },`,
    `});`,
    ``,
  ].join('\n'));
  const result = spawnSync('npx', ['playwright', 'test', specPath, '--config', configPath, '--workers=1', '--reporter=line'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, CI: '0' },
    encoding: 'utf8',
    timeout: 180_000,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  fs.writeFileSync(path.join(rawReplayDir, 'raw-replay-output.txt'), output);
  if (result.status !== 0)
    throw new Error(`Generated Playwright source failed as a standalone spec (exit ${result.status}). See ${rawReplayDir}/raw-replay-output.txt\n${output}`);
}

function rawReplayBaseURL() {
  return process.env.PLAYWRIGHT_CRX_TEST_BASE_URL || `http://127.0.0.1:${process.env.PLAYWRIGHT_CRX_TEST_PORT || '3107'}`;
}

function testBody(code: string) {
  const header = code.match(/test\([^,]+,\s*async\s*\(\{\s*page\s*\}\)\s*=>\s*\{/);
  if (!header)
    throw new Error(`Unable to find generated Playwright test header:\n${code}`);
  const bodyStart = (header.index ?? 0) + header[0].length;
  let bodyEnd = code.lastIndexOf('\n});');
  if (bodyEnd < bodyStart)
    bodyEnd = code.lastIndexOf('});');
  if (bodyEnd < bodyStart)
    throw new Error(`Unable to extract generated Playwright test body:\n${code}`);
  return code.slice(bodyStart, bodyEnd)
      .split('\n')
      .filter(line => !line.trimStart().startsWith('//'))
      .join('\n');
}
