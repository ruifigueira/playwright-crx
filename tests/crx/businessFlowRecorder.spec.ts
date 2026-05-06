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
import type { TestInfo } from '@playwright/test';
import type { Page, BrowserContext } from 'playwright-core';
import { test, expect } from './crxRecorderTest';

test.describe.configure({ mode: 'serial' });

test('records a real AntD user business flow through the plugin UI, exports it, and replays generated Playwright code @smoke', async ({ context, page, attachRecorder, baseURL }) => {
  test.setTimeout(120_000);

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibrary(recorderPage);
  await fillFlowMeta(recorderPage, '流程名称', 'AntD 用户流程 E2E');
  await fillFlowMeta(recorderPage, '应用', 'AntD Admin');
  await fillFlowMeta(recorderPage, '模块', '用户管理');
  await fillFlowMeta(recorderPage, '页面', '用户列表');
  await fillFlowMeta(recorderPage, '角色', '运营');
  await recorderPage.getByRole('button', { name: '创建并开始录制' }).click();

  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-users-real.html`);
  await expect(page.getByTestId('create-user-btn')).toBeVisible();
  await attachRecorder(page, { mode: 'business-flow' });

  await page.getByTestId('create-user-btn').locator('svg').click();
  await page.getByPlaceholder('请输入用户名').fill('alice');
  await page.getByTestId('role-select').click();
  await clickVisibleAntDOption(page, '审计员');
  await page.getByTestId('modal-confirm').locator('span').click();
  await expect(page.getByTestId('create-user-modal')).not.toBeVisible();
  await page.waitForTimeout(2200);
  const user42Row = page.getByTestId('users-table').locator('tr[data-row-key="user-42"]');
  await user42Row.click();
  await page.waitForTimeout(250);
  await user42Row.getByRole('button', { name: '编辑' }).click();
  await page.waitForTimeout(250);

  await expect.poll(() => recorderPage.locator('.flow-step').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(5);
  await expect.poll(async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n')).toContain('create-user-btn');
  await expect.poll(async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n')).toContain('alice');
  await expect.poll(async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n')).toContain('Alice 管理员 编辑');

  await recorderPage.getByRole('button', { name: '停止录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

  const exportedJson = await downloadTextAfterClick(
      recorderPage,
      recorderPage.getByRole('button', { name: '导出流程 JSON' }).last(),
  );
  const exportedYaml = await downloadTextAfterClick(
      recorderPage,
      recorderPage.getByRole('button', { name: '导出紧凑 YAML' }).last(),
  );

  const flow = JSON.parse(exportedJson);
  expect(flow.flow.name).toBe('AntD 用户流程 E2E');
  expect(flow.steps.length).toBeGreaterThanOrEqual(5);
  expect(flow.steps.some((step: any) => step.target?.testId === 'create-user-btn')).toBeTruthy();
  expect(flow.steps.some((step: any) => step.target?.placeholder === '请输入用户名' || step.target?.scope?.form?.label === '用户名')).toBeTruthy();
  expect(flow.steps.some((step: any) => step.target?.scope?.table?.rowKey === 'user-42')).toBeTruthy();
  expect(flow.artifacts.playwrightCode).toMatch(/getByTestId\(["']create-user-btn["']\)/);
  expect(flow.artifacts.playwrightCode).toMatch(/getByRole\(["']textbox["'],\s*\{\s*name:\s*["']\*?\s*用户名["']|getByLabel\(["']用户名["']\)/);
  expect(flow.artifacts.playwrightCode).toContain('审计员');
  expect(flow.artifacts.playwrightCode).toMatch(/getByTestId\(["']users-table["']\)/);
  expect(flow.artifacts.playwrightCode).toContain('data-row-key=\\"user-42\\"');
  expect(exportedYaml).toContain('AntD 用户流程 E2E');
  expect(exportedYaml).toContain('user-42');

  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, test.info());
});

test('records a real AntD ProComponents async create-and-use flow @smoke', async ({ context, page, attachRecorder, baseURL }) => {
  test.setTimeout(120_000);

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibrary(recorderPage);
  await fillFlowMeta(recorderPage, '流程名称', '真实 AntD ProComponents 条目流程');
  await fillFlowMeta(recorderPage, '应用', 'AntD Pro');
  await fillFlowMeta(recorderPage, '模块', '条目管理');
  await fillFlowMeta(recorderPage, '页面', '真实组件页');
  await fillFlowMeta(recorderPage, '角色', '运营');
  await recorderPage.getByRole('button', { name: '创建并开始录制' }).click();

  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-real.html`);
  await expect(page.getByText('真实 AntD ProComponents 页面')).toBeVisible();
  await expect(page.getByTestId('real-create-item')).toBeVisible();
  await attachRecorder(page, { mode: 'business-flow' });

  await page.getByTestId('real-create-item').locator('svg').click();
  await page.getByPlaceholder('请输入条目名称').fill('real-item-a');
  await page.getByPlaceholder('请输入负责人').fill('真实运营');
  await page.getByRole('button', { name: /保\s*存/ }).click();
  await expect(page.getByRole('row', { name: /real-item-a/ })).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('real-used-item-select').click();
  await clickVisibleAntDOption(page, 'real-item-a');
  await page.getByPlaceholder('填写使用备注').fill('下方表单使用刚保存的条目');

  await expect.poll(() => recorderPage.locator('.flow-step').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(7);
  await expect.poll(async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n')).toContain('real-create-item');
  await expect.poll(async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n')).toContain('real-item-a');
  await expect.poll(async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n')).toContain('下方表单使用条目');

  await recorderPage.getByRole('button', { name: '停止录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

  const exportedJson = await downloadTextAfterClick(
      recorderPage,
      recorderPage.getByRole('button', { name: '导出流程 JSON' }).last(),
  );
  const flow = JSON.parse(exportedJson);

  expect(flow.flow.name).toBe('真实 AntD ProComponents 条目流程');
  expect(flow.steps.length).toBeGreaterThanOrEqual(7);
  expect(flow.steps.some((step: any) => step.target?.testId === 'real-create-item')).toBeTruthy();
  expect(flow.steps.some((step: any) => step.value === 'real-item-a' || [step.target?.label, step.target?.placeholder, step.target?.name, step.target?.displayName, step.target?.text].some(value => /条目名称|请输入条目名称/.test(String(value || ''))))).toBeTruthy();
  expect(flow.steps.some((step: any) => [step.target?.label, step.target?.displayName, step.target?.name, step.target?.placeholder, step.target?.testId].some(value => /下方表单使用条目|选择刚保存的条目|real-used-item-select/.test(String(value || ''))))).toBeTruthy();
  expect(flow.artifacts.playwrightCode).toContain('antd-pro-real.html');
  expect(flow.artifacts.playwrightCode).toMatch(/real-create-item|新建条目/);
  expect(flow.artifacts.playwrightCode).toContain('real-item-a');
  expect(flow.artifacts.playwrightCode).toMatch(/locator\(["']\.ant-select-dropdown:not\(\.ant-select-dropdown-hidden\)["']\)\.last\(\)\.locator\(["']\.ant-select-item-option["']\)\.filter\(\{\s*hasText:\s*["']real-item-a["']\s*\}\)/);
  expect(flow.artifacts.playwrightCode).toContain('AntD Select virtual dropdown replay workaround');
  expect(flow.artifacts.playwrightCode).toContain('dispatchEvent(new MouseEvent("mousedown"');
  expect(flow.artifacts.playwrightCode).toMatch(/waitFor\(\{ state: .*hidden.*timeout: 1000 \}\)/);
  expect(flow.artifacts.playwrightCode).toContain('下方表单使用刚保存的条目');

  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, test.info());
});


test('records real ProFormField network configuration fields and replays generated code @proform-fields', async ({ context, page, attachRecorder, baseURL }) => {
  test.setTimeout(210_000);

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibrary(recorderPage);
  await fillFlowMeta(recorderPage, '流程名称', 'ProFormField 网络配置流程');
  await fillFlowMeta(recorderPage, '应用', 'AntD Pro');
  await fillFlowMeta(recorderPage, '模块', '网络配置');
  await fillFlowMeta(recorderPage, '页面', '资源配置');
  await fillFlowMeta(recorderPage, '角色', '网络管理员');
  await recorderPage.getByRole('button', { name: '创建并开始录制' }).click();

  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-form-fields.html`);
  await expect(page.getByText('网络配置资源')).toBeVisible();
  await attachRecorder(page, { mode: 'business-flow' });
  await page.getByTestId('network-resource-add').click();
  await expect(page.getByRole('dialog', { name: '新建网络资源' })).toBeVisible();

  await page.getByTestId('network-resource-save').click();
  await expect(page.locator('.ant-form-item-explain-error').filter({ hasText: '请输入资源名称' })).toBeVisible();
  await expect(page.locator('.ant-form-item-explain-error').filter({ hasText: '选择一个WAN口' })).toBeVisible();

  await page.getByPlaceholder('地址池名称').fill('pool-proform-alpha');
  await page.getByTestId('network-resource-wan-select').click();
  await page.getByTestId('network-resource-wan-select').locator('input').fill('WAN-extra-18');
  await clickVisibleAntDOption(page, 'edge-lab:WAN-extra-18');
  await expect(page.getByTestId('network-resource-wan-select')).toContainText('edge-lab:WAN-extra-18');
  await page.getByText('独享地址池').click();
  await page.waitForTimeout(250);
  await page.getByTestId('network-resource-vrf-select').click();
  await page.getByTestId('network-resource-vrf-select').locator('input').fill('生产');
  await clickVisibleAntDOption(page, '生产VRF');
  await expect(page.getByTestId('network-resource-vrf-select')).toContainText('生产VRF');
  const networkResourceDialog = page.getByRole('dialog', { name: '新建网络资源' });
  const arpProxyItem = networkResourceDialog.locator('.ant-form-item').filter({ hasText: '能力开关' });
  const arpProxyCheckbox = arpProxyItem.getByRole('checkbox', { name: '开启代理ARP' });
  await arpProxyItem.getByText('开启代理ARP').click();
  await expect(arpProxyCheckbox).toBeChecked();
  await page.getByText('启用健康检查').click();
  await expect(page.getByTestId('network-resource-health-url')).toBeVisible();
  await page.getByTestId('network-resource-health-url').fill('https://probe.example/health');
  await page.getByTestId('network-resource-scope-tree').click();
  await clickVisibleAntDTreeNode(page, '华东生产区');
  await expect(page.getByTestId('network-resource-scope-tree')).toContainText('华东生产区');
  await page.getByTestId('network-resource-egress-cascader').click();
  await clickVisibleAntDCascaderOption(page, '上海');
  await clickVisibleAntDCascaderOption(page, '一号机房');
  await clickVisibleAntDCascaderOption(page, 'NAT集群A');
  await expect(page.getByTestId('network-resource-egress-cascader')).toContainText('NAT集群A');
  await page.getByPlaceholder('服务名称').fill('https-admin');
  await page.getByPlaceholder('监听端口').fill('8443');
  await page.waitForTimeout(250);
  await page.getByTestId('network-resource-source-port').fill('8443');
  await page.waitForTimeout(250);
  await page.getByPlaceholder('填写策略备注').fill('ProFormField 全量组合录制：showSearch/TreeSelect/Cascader/List/Dependency/Switch');
  await page.getByTestId('network-resource-save').click();
  await expect(page.getByRole('row', { name: /pool-proform-alpha/ })).toBeVisible({ timeout: 10_000 });

  await expect.poll(() => recorderPage.locator('.flow-step').count(), { timeout: 25_000 }).toBeGreaterThanOrEqual(9);
  const stepSubjects = async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n');
  await expect.poll(stepSubjects).toContain('network-resource-add');
  await expect.poll(stepSubjects).toContain('pool-proform-alpha');
  await expect.poll(stepSubjects).toMatch(/WAN口|选择一个WAN口|network-resource-wan-select/);

  await recorderPage.getByRole('button', { name: '停止录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

  const flow = await exportBusinessFlowJson(recorderPage);
  writeGeneratedReplayDiagnostic(test.info(), 'proform-fields', flow);
  expect(flow.flow.name).toBe('ProFormField 网络配置流程');
  expect(flow.steps.length).toBeGreaterThanOrEqual(18);
  expect(flow.steps.some((step: any) => step.target?.testId === 'network-resource-add')).toBeTruthy();
  expect(flow.steps.some((step: any) => step.target?.testId === 'network-resource-name' || step.target?.placeholder === '地址池名称' || step.target?.label === '资源名称')).toBeTruthy();
  expect(flow.steps.some((step: any) => [step.target?.label, step.target?.displayName, step.target?.name, step.target?.placeholder, step.target?.testId].some(value => /WAN口|选择一个WAN口|network-resource-wan-select/.test(String(value || ''))))).toBeTruthy();
  expect(flow.steps.some((step: any) => [step.target?.label, step.target?.displayName, step.target?.name, step.target?.text].some(value => /类型|独享地址池|poolType/.test(String(value || ''))))).toBeTruthy();
  const serializedProFormTargets = JSON.stringify(flow.steps.map((step: any) => step.target), null, 2);
  expect(serializedProFormTargets).toMatch(/开启代理ARP|arpProxy/);
  expect(flow.artifacts.playwrightCode).toContain('antd-pro-form-fields.html');
  expect(flow.artifacts.playwrightCode).toContain('pool-proform-alpha');
  expect(flow.artifacts.playwrightCode).toContain('edge-lab:WAN-extra-18');
  expect(flow.artifacts.playwrightCode).not.toContain('edge-lab:WAN1-copy');
  expect(flow.artifacts.playwrightCode).toContain('生产VRF');
  expect(flow.artifacts.playwrightCode).toContain('华东生产区');
  expect(flow.artifacts.playwrightCode).toContain('NAT集群A');
  expect(flow.artifacts.playwrightCode).toContain('https-admin');
  expect(flow.artifacts.playwrightCode).toContain('https://probe.example/health');
  expect(flow.artifacts.playwrightCode).toContain('8443');
  expect(flow.artifacts.playwrightCode).toContain('ProFormField 全量组合录制');
  expect(flow.artifacts.playwrightCode).toContain('AntD Select virtual dropdown replay workaround');
  expect(flow.artifacts.playwrightCode).toContain('dispatchEvent(new MouseEvent("mousedown"');
  expectInOrder(flow.artifacts.playwrightCode, [
    'network-resource-add',
    'network-resource-save',
    'pool-proform-alpha',
  ]);
  assertNoNetworkResourceSubmitBeforeRequiredFields(flow.artifacts.playwrightCode);

  const replayVerification = [
    `await expect(page.getByTestId("network-resource-table")).toContainText("pool-proform-alpha", { timeout: 10000 });`,
    `await expect(page.getByTestId("network-resource-table")).toContainText("edge-lab:WAN-extra-18");`,
    `await expect(page.getByTestId("network-resource-table")).toContainText("生产VRF");`,
    `await expect(page.getByTestId("network-resource-table")).toContainText("华东生产区");`,
    `await expect(page.getByTestId("network-resource-table")).toContainText("NAT集群A");`,
    `await expect(page.getByTestId("network-resource-table")).toContainText("https-admin:8443");`,
    `await expect(page.getByTestId("network-resource-table")).toContainText("ProFormField 全量组合录制");`,
  ];
  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, test.info(), async replayPage => {
    const table = replayPage.getByTestId('network-resource-table');
    await expect(table).toContainText('pool-proform-alpha', { timeout: 10_000 });
    await expect(table).toContainText('edge-lab:WAN-extra-18');
    await expect(table).toContainText('生产VRF');
    await expect(table).toContainText('华东生产区');
    await expect(table).toContainText('NAT集群A');
    await expect(table).toContainText('https-admin:8443');
    await expect(table).toContainText('ProFormField 全量组合录制');
  }, replayVerification);
});


test('records an IPv4 address pool ProFormSelect WAN flow and replays generated code @ipv4-pool', async ({ context, page, attachRecorder, baseURL }) => {
  test.setTimeout(150_000);

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.accept());

  await beginNewFlowFromLibrary(recorderPage);
  await fillFlowMeta(recorderPage, '流程名称', '地址池');
  await fillFlowMeta(recorderPage, '应用', 'AntD Pro');
  await fillFlowMeta(recorderPage, '模块', '站点配置');
  await fillFlowMeta(recorderPage, '页面', '全局配置');
  await fillFlowMeta(recorderPage, '角色', 'admin');
  await recorderPage.getByRole('button', { name: '创建并开始录制' }).click();

  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.goto(`${baseURL}/antd-pro-form-fields.html`);
  await expect(page.getByText('地址池与端口池')).toBeVisible();
  await attachRecorder(page, { mode: 'business-flow' });
  await page.getByTestId('site-ip-address-pool-create-button').click();
  await expect(page.getByRole('dialog', { name: '新建IPv4地址池' })).toBeVisible();

  await page.getByPlaceholder('地址池名称').fill('test1');
  const ipv4Dialog = page.locator('.ant-modal, .ant-drawer, [role="dialog"]').filter({ hasText: '新建IPv4地址池' });
  await ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' }).locator('.ant-select-selector').first().click();
  await clickVisibleAntDOption(page, 'xtest16:WAN1');
  await expect(ipv4Dialog.locator('.ant-form-item').filter({ hasText: 'WAN口' })).toContainText('xtest16:WAN1');
  await page.getByLabel('开始地址，例如：192.168.1.1').click();
  await page.getByRole('textbox', { name: '开始地址，例如：' }).fill('1.1.1.1');
  await page.getByLabel('结束地址，例如：192.168.1.254').click();
  await page.getByRole('textbox', { name: '结束地址，例如：' }).fill('2.2.2.2');
  await expect(page.getByRole('textbox', { name: '开始地址，例如：' })).toHaveValue('1.1.1.1');
  await expect(page.getByRole('textbox', { name: '结束地址，例如：' })).toHaveValue('2.2.2.2');
  const ipv4ConfirmButton = ipv4Dialog.getByRole('button', { name: '确 定' });
  await expect(ipv4ConfirmButton).toBeEnabled({ timeout: 10_000 });
  const targetIpv4Row = page.getByRole('row', { name: /test1.*xtest16:WAN1.*1\.1\.1\.1.*2\.2\.2\.2/ });
  for (let attempt = 0; attempt < 4 && await ipv4Dialog.isVisible().catch(() => false); attempt++) {
    try {
      await ipv4ConfirmButton.click({ timeout: 5_000 });
    } catch (error) {
      if (!await ipv4Dialog.isVisible().catch(() => false) || await targetIpv4Row.isVisible().catch(() => false))
        break;
      throw error;
    }
    await page.waitForTimeout(500);
  }
  await expect(ipv4Dialog).toBeHidden({ timeout: 10_000 });
  await expect(targetIpv4Row).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('site-save-button').click();
  await expect(page.getByText('配置已保存')).toBeVisible();

  await expect.poll(() => recorderPage.locator('.flow-step').count(), { timeout: 25_000 }).toBeGreaterThanOrEqual(9);
  const stepSubjects = async () => (await recorderPage.locator('.flow-step-subject').allInnerTexts()).join('\n');
  await expect.poll(stepSubjects).toContain('site-ip-address-pool-create-button');
  await expect.poll(stepSubjects).toContain('test1');
  await expect.poll(stepSubjects).toMatch(/WAN口|选择一个WAN口|xtest16:WAN1/);

  await recorderPage.getByRole('button', { name: '停止录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

  let flow = await exportBusinessFlowJson(recorderPage);
  expect(flow.flow.name).toBe('地址池');
  expect(flow.steps.length).toBeGreaterThanOrEqual(9);
  expect(flow.steps.some((step: any) => step.target?.testId === 'site-ip-address-pool-create-button')).toBeTruthy();
  expect(flow.steps.some((step: any) => [step.target?.label, step.target?.displayName, step.target?.name, step.target?.text].some(value => /WAN口|选择一个WAN口|xtest16:WAN1/.test(String(value || ''))))).toBeTruthy();

  const createStepId = requiredStepId(flow, (step: any) => step.target?.testId === 'site-ip-address-pool-create-button', 'IPv4 pool create button step');
  const confirmStepId = requiredStepId(flow, (step: any) => step.target?.testId === 'ipv4-address-pool-confirm' || /确\s*定/.test(String(step.target?.name || step.target?.text || step.target?.displayName || '')), 'IPv4 pool modal confirm step');
  const saveConfigStepId = requiredStepId(flow, (step: any) => step.target?.testId === 'site-save-button', 'site save config step');
  const repeatStepIds = flow.steps
      .filter((step: any) => stepIndex(flow, step.id) >= stepIndex(flow, createStepId) && stepIndex(flow, step.id) <= stepIndex(flow, confirmStepId))
      .map((step: any) => step.id);
  expect(repeatStepIds.length).toBeGreaterThanOrEqual(6);
  expect(repeatStepIds).toContain(createStepId);
  expect(repeatStepIds).toContain(confirmStepId);
  expect(repeatStepIds).not.toContain(saveConfigStepId);

  for (const stepId of repeatStepIds)
    await recorderPage.locator(`button[aria-label="选择 ${stepId} 作为循环步骤"]`).click();
  await expect(recorderPage.locator('.repeat-create-actions .primary')).toBeEnabled();
  await recorderPage.locator('.repeat-create-actions .primary').click();
  await expect(recorderPage.locator('.repeat-editor')).toBeVisible({ timeout: 10_000 });
  if (await recorderPage.locator('.repeat-data').isVisible().catch(() => false))
    await recorderPage.getByRole('button', { name: '返回上一步' }).click();
  await expect(recorderPage.locator('.repeat-mapping')).toBeVisible({ timeout: 10_000 });
  await recorderPage.locator('.repeat-mapping label').filter({ hasText: '片段名称' }).locator('input').fill('批量创建IPv4地址池');
  await recorderPage.getByRole('button', { name: '生成数据表' }).click();
  await expect.poll(async () => await recorderPage.locator('.repeat-data input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value).join('\n'))).toContain('test1');
  await recorderPage.getByRole('button', { name: '保存片段' }).click();
  await expect(recorderPage.locator('.repeat-segment-card')).toContainText('批量创建IPv4地址池');

  flow = await exportBusinessFlowJson(recorderPage);
  expect(flow.repeatSegments?.[0]?.stepIds).toEqual(repeatStepIds);
  expect(flow.repeatSegments?.[0]?.stepIds).not.toContain(saveConfigStepId);
  expect(flow.repeatSegments?.[0]?.parameters.map((parameter: any) => parameter.variableName)).toEqual(expect.arrayContaining(['poolName', 'wanPort', 'startIp', 'endIp']));
  expect(flow.repeatSegments?.[0]?.rows.length).toBeGreaterThanOrEqual(3);
  expect(flow.artifacts.playwrightCode).toContain('for (const row of');
  expect(flow.artifacts.playwrightCode).toContain('批量创建IPv4地址池');
  expect(flow.artifacts.playwrightCode).toContain('antd-pro-form-fields.html');
  expect(flow.artifacts.playwrightCode).toContain('site-ip-address-pool-create-button');
  expect(flow.artifacts.playwrightCode).toContain('test1');
  expect(flow.artifacts.playwrightCode).toContain('xtest16:WAN1');
  expect(flow.artifacts.playwrightCode).toContain('1.1.1.1');
  expect(flow.artifacts.playwrightCode).toContain('2.2.2.2');
  expect(flow.artifacts.playwrightCode).toMatch(/locator\(["']\.ant-modal, \.ant-drawer, \[role=\\?["']dialog\\?["']\]["']\)[\s\S]*filter\(\{ hasText: ["']新建IPv4地址池["'] \}\)[\s\S]*locator\(["']\.ant-form-item["']\)[\s\S]*filter\(\{ hasText: ["']WAN口["'] \}\)[\s\S]*locator\(["']\.ant-select-selector["']\)/);
  expect(flow.artifacts.playwrightCode).not.toMatch(/getByRole\(["']combobox["'],\s*\{\s*name:\s*["']WAN口["']/);
  expect(flow.artifacts.playwrightCode).not.toContain('#rc_select_');

  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, test.info());
});


test('keeps plugin edits stable across middle insert, wait, repeat segment, saved continue, and generated replay @plugin-stability', async ({ context, page, attachRecorder, baseURL }) => {
  test.setTimeout(180_000);

  await page.goto(`${baseURL}/empty.html`);
  const recorderPage = await attachRecorder(page, { mode: 'business-flow' });
  recorderPage.on('dialog', dialog => dialog.accept('1'));

  const flowName = `插件稳定性流程 ${Date.now()}`;
  await beginNewFlowFromLibrary(recorderPage);
  await fillFlowMeta(recorderPage, '流程名称', flowName);
  await fillFlowMeta(recorderPage, '应用', 'AntD Admin');
  await fillFlowMeta(recorderPage, '模块', '稳定性编辑');
  await fillFlowMeta(recorderPage, '页面', '循环与插入');
  await fillFlowMeta(recorderPage, '角色', '测试');
  await recorderPage.getByRole('button', { name: '创建并开始录制' }).click();

  await page.goto(`${baseURL}/antd-business-flow-stability.html`);
  await expect(page.getByText('业务流程稳定性测试页')).toBeVisible();
  await attachRecorder(page, { mode: 'business-flow' });
  await page.getByTestId('site-ip-add').click();
  await page.getByPlaceholder('地址池名称').fill('pool-alpha');
  await page.getByTestId('site-save-button').click();
  await expect(page.getByRole('row', { name: /pool-alpha/ })).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder('填写使用备注').fill('初始保存后备注');

  await expect.poll(() => recorderPage.locator('.flow-step').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
  await recorderPage.getByRole('button', { name: '停止录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

  let flow = await exportBusinessFlowJson(recorderPage);
  const addStepId = flow.steps.find((step: any) => step.target?.testId === 'site-ip-add')?.id || requiredStepId(flow, (step: any) => step.action === 'navigate', 'initial anchor step');
  const fillStepId = requiredStepId(flow, (step: any) => step.value === 'pool-alpha', 'pool name fill step');
  const saveStepId = requiredStepId(flow, (step: any) => step.target?.testId === 'site-save-button' || /保存配置/.test(String(step.target?.name || step.target?.text || step.target?.displayName || '')), 'save step');

  await openInsertMenuAfterStep(recorderPage, addStepId);
  await recorderPage.getByRole('button', { name: '从这里继续录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');
  await expect(recorderPage.locator('.insert-recording-banner')).toContainText(addStepId);
  await page.getByTestId('site-ip-validate').click();
  await expect(page.getByTestId('event-log')).toContainText('validate');
  await recorderPage.getByRole('button', { name: '停止录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');

  flow = await exportBusinessFlowJson(recorderPage);
  const validateStepId = requiredStepId(flow, (step: any) => step.target?.testId === 'site-ip-validate', 'inserted validate step');
  expect(stepIndex(flow, validateStepId)).toBe(stepIndex(flow, addStepId) + 1);

  await openInsertMenuAfterStep(recorderPage, saveStepId);
  await recorderPage.getByRole('button', { name: '插入等待' }).click();
  await expect(recorderPage.locator('.review-step-list')).toContainText('等待');

  flow = await exportBusinessFlowJson(recorderPage);
  const waitStepId = requiredStepId(flow, (step: any) => step.action === 'wait', 'inserted wait step');
  expect(stepIndex(flow, waitStepId)).toBe(stepIndex(flow, saveStepId) + 1);

  await recorderPage.getByRole('button', { name: '选择全部' }).click();
  await expect(recorderPage.locator('.repeat-create-actions .primary')).toBeEnabled();
  await recorderPage.locator('.repeat-create-actions .primary').click();
  await expect(recorderPage.locator('.repeat-editor')).toBeVisible({ timeout: 10_000 });
  if (await recorderPage.locator('.repeat-mapping').isVisible().catch(() => false)) {
    await recorderPage.locator('.repeat-mapping label').filter({ hasText: '片段名称' }).locator('input').fill('批量保存地址池');
    await recorderPage.getByRole('button', { name: '生成数据表' }).click();
  }
  await expect.poll(async () => await recorderPage.locator('.repeat-data input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value).join('\n'))).toContain('pool-alpha');
  await recorderPage.getByRole('button', { name: '保存片段' }).click();
  await expect(recorderPage.locator('.repeat-segment-card')).toContainText(/批量保存地址池|批量执行/);

  await recorderPage.getByRole('button', { name: '保存记录' }).click();
  await openSavedRecord(recorderPage, flowName);
  await recorderPage.getByRole('button', { name: '继续录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText('录制中');

  await page.getByTestId('stability-wan-select').click();
  await clickVisibleAntDOption(page, 'WAN1');
  await expect(page.getByTestId('stability-wan-select')).toContainText('WAN1', { timeout: 10_000 });
  await page.waitForTimeout(250);
  await page.getByPlaceholder('填写使用备注').fill('循环后继续补步骤');
  await page.getByTestId('site-post-save-action').click();
  await expect(page.getByTestId('event-log')).toContainText('post-save');
  await page.waitForTimeout(1200);
  await recorderPage.getByRole('button', { name: '停止录制' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');
  await recorderPage.getByRole('button', { name: '保存记录' }).click();

  await openSavedRecord(recorderPage, flowName);
  flow = await exportBusinessFlowJson(recorderPage);
  expect(flow.repeatSegments?.[0]?.stepIds).toEqual(expect.arrayContaining([fillStepId, saveStepId, waitStepId]));
  expect(flow.steps.some((step: any) => step.target?.testId === 'site-ip-validate')).toBeTruthy();
  expect(flow.steps.some((step: any) => step.action === 'wait')).toBeTruthy();
  expect(flow.artifacts.playwrightCode).toContain('for (const row of');
  expect(flow.artifacts.playwrightCode).toMatch(/批量保存地址池|批量执行/);
  expect(flow.artifacts.playwrightCode).toContain('WAN1');
  expect(flow.artifacts.playwrightCode).not.toContain('WAN1-copy');
  expect(flow.artifacts.playwrightCode).toContain('AntD Select virtual dropdown replay workaround');

  await replayGeneratedPlaywrightCode(context, flow.artifacts.playwrightCode, test.info());
});

// L2 deterministic recorder helpers: these specs intentionally use Playwright's
// high-level click/fill plus dispatchEvent for difficult AntD portals so they stay
// stable as regression tests. They are not treated as human-like coverage; see
// humanLikeRecorder.spec.ts for the L3 smoke path that drives mouse/keyboard actions.
async function beginNewFlowFromLibrary(recorderPage: Page) {
  const newFlowButton = recorderPage.getByRole('button', { name: '+ 新建流程' });
  if (!await newFlowButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    const backToLibrary = recorderPage.getByRole('button', { name: /返回流程库/ }).first();
    if (await backToLibrary.isVisible({ timeout: 3000 }).catch(() => false))
      await backToLibrary.click();
  }
  await expect(newFlowButton).toBeVisible({ timeout: 10_000 });
  await newFlowButton.click();
  await expect(recorderPage.locator('.flow-meta-panel')).toBeVisible({ timeout: 10_000 });
}

async function fillFlowMeta(recorderPage: Page, label: string, value: string) {
  await recorderPage.locator('.flow-meta-panel label').filter({ hasText: label }).locator('input, textarea').first().fill(value);
}

async function clickVisibleAntDOption(page: Page, text: string) {
  const options = page
      .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
      .last()
      .locator('.ant-select-item-option')
      .filter({ hasText: text });
  const option = options.first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click({ timeout: 5_000 }).catch(async () => {
    await options.evaluateAll((elements, expectedText) => {
      const normalize = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim();
      const expected = normalize(expectedText);
      const element = elements.find(element => {
        const optionText = normalize((element.querySelector('.ant-select-item-option-content') as HTMLElement | null)?.textContent);
        return normalize(element.getAttribute('title')) === expected || optionText === expected || normalize(element.textContent) === expected;
      });
      if (!element)
        throw new Error(`AntD option not found exactly: ${expected}`);
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }, text);
  });
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').first().waitFor({ state: 'hidden', timeout: 1000 }).catch(() => {});
}


async function clickVisibleAntDTreeNode(page: Page, text: string) {
  const nodes = page
      .locator('.ant-select-tree-node-content-wrapper')
      .filter({ hasText: text });
  const node = nodes.first();
  await expect(node).toBeVisible({ timeout: 10_000 });
  await node.click({ timeout: 5_000 }).catch(async () => {
    await nodes.evaluateAll((elements, expectedText) => {
      const normalize = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim();
      const expected = normalize(expectedText);
      const element = elements.find(element => normalize(element.textContent) === expected);
      if (!element)
        throw new Error(`AntD tree node not found exactly: ${expected}`);
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }, text);
  });
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').first().waitFor({ state: 'hidden', timeout: 1000 }).catch(() => {});
}

async function clickVisibleAntDCascaderOption(page: Page, text: string) {
  const options = page
      .locator('.ant-cascader-dropdown:not(.ant-cascader-dropdown-hidden) .ant-cascader-menu-item')
      .filter({ hasText: text });
  const option = options.first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click({ timeout: 5_000 }).catch(async () => {
    await options.evaluateAll((elements, expectedText) => {
      const normalize = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim();
      const expected = normalize(expectedText);
      const element = elements.find(element => normalize(element.textContent) === expected);
      if (!element)
        throw new Error(`AntD cascader option not found exactly: ${expected}`);
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }, text);
  });
}

async function exportBusinessFlowJson(recorderPage: Page) {
  const exportedJson = await downloadTextAfterClick(
      recorderPage,
      recorderPage.getByRole('button', { name: '导出流程 JSON' }).last(),
  );
  return JSON.parse(exportedJson);
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

async function openInsertMenuAfterStep(recorderPage: Page, stepId: string) {
  await recorderPage.evaluate(id => {
    const rows = Array.from(document.querySelectorAll('.review-step-row'));
    const row = rows.find(row => row.textContent?.includes(id));
    const slot = row?.nextElementSibling as HTMLElement | undefined;
    const button = slot?.querySelector('button') as HTMLButtonElement | null;
    if (!button)
      throw new Error(`Unable to find insert slot after ${id}`);
    button.click();
  }, stepId);
  await expect(recorderPage.locator('.review-insert-popover')).toBeVisible({ timeout: 10_000 });
}

async function openSavedRecord(recorderPage: Page, flowName: string) {
  const card = recorderPage.locator('.library-card').filter({ hasText: flowName }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole('button', { name: '打开' }).click();
  await expect(recorderPage.locator('.recording-status')).toContainText('复查');
}

async function downloadTextAfterClick(recorderPage: Page, trigger: ReturnType<Page['locator']>) {
  const [download] = await Promise.all([
    recorderPage.waitForEvent('download'),
    trigger.click(),
  ]);
  const stream = await download.createReadStream();
  return await new Promise<string>((resolve, reject) => {
    let text = '';
    stream.on('data', chunk => text += chunk.toString());
    stream.on('end', () => resolve(text));
    stream.on('error', reject);
  });
}

function writeGeneratedReplayDiagnostic(testInfo: TestInfo, name: string, flow: any) {
  const rawReplayRoot = path.join(__dirname, '..', '.raw-generated-replay');
  const diagnosticDir = path.join(rawReplayRoot, `${testInfo.workerIndex}-${name}-diagnostic-${Date.now()}`);
  fs.mkdirSync(diagnosticDir, { recursive: true });
  fs.writeFileSync(path.join(diagnosticDir, 'generated-before-assert.spec.ts'), flow.artifacts?.playwrightCode || '');
  fs.writeFileSync(path.join(diagnosticDir, 'business-flow.json'), JSON.stringify(flow, null, 2));
}

async function replayGeneratedPlaywrightCode(context: BrowserContext, code: string, testInfo?: TestInfo, verify?: (page: Page) => Promise<void>, standaloneVerification?: string[]) {
  if (testInfo) {
    const rawReplayDir = testInfo.outputPath('raw-generated-replay');
    fs.mkdirSync(rawReplayDir, { recursive: true });
    fs.writeFileSync(path.join(rawReplayDir, 'generated-before-inline.spec.ts'), code);
  }
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
  if (testInfo)
    runGeneratedPlaywrightSourceAsStandaloneSpec(code, testInfo, standaloneVerification);
}

function expectInOrder(text: string, markers: Array<string | RegExp>) {
  let offset = 0;
  for (const marker of markers) {
    const slice = text.slice(offset);
    const index = typeof marker === 'string' ? slice.indexOf(marker) : slice.search(marker);
    expect(index, `missing marker after offset ${offset}: ${String(marker)}`).toBeGreaterThanOrEqual(0);
    offset += index + 1;
  }
}

function assertNoNetworkResourceSubmitBeforeRequiredFields(code: string) {
  const finalSaveIndex = code.lastIndexOf('network-resource-save');
  expect(finalSaveIndex, 'network-resource-save final submit should exist').toBeGreaterThanOrEqual(0);
  const tailAfterFinalSave = code.slice(finalSaveIndex + 'network-resource-save'.length);
  for (const marker of [
    'pool-proform-alpha',
    'edge-lab:WAN-extra-18',
    '生产VRF',
    '开启代理ARP',
    '启用健康检查',
    'network-resource-health-switch',
    'https://probe.example/health',
    '华东生产区',
    'NAT集群A',
    'https-admin',
    '8443',
    'ProFormField 全量组合录制',
    '服务名称',
    '监听端口',
    'network-resource-source-port',
    'network-resource-remark',
  ])
    expect(tailAfterFinalSave, `required field marker should not appear after final network-resource-save: ${marker}`).not.toContain(marker);
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

function antDUsersFixture() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>AntD Users Fixture</title>
    <style>
      body { font-family: sans-serif; margin: 24px; }
      .ant-modal { display: none; border: 1px solid #ddd; padding: 16px; margin: 16px 0; }
      .ant-modal.open { display: block; }
      .ant-select-dropdown { display: none; border: 1px solid #ddd; padding: 8px; width: 180px; }
      .ant-select-dropdown.open { display: block; }
      .ant-btn { margin: 4px; }
      table { border-collapse: collapse; margin-top: 12px; }
      td, th { border: 1px solid #ddd; padding: 6px 10px; }
    </style>
  </head>
  <body>
    <section class="ant-pro-card" data-testid="user-admin-card">
      <div class="ant-pro-card-title">用户管理</div>
      <button class="ant-btn ant-btn-primary" data-testid="create-user-btn" type="button">
        <span>新建用户</span>
        <span class="anticon"><svg data-icon="plus" width="12" height="12"><path d="M6 1v10M1 6h10"></path></svg></span>
      </button>
      <div class="ant-modal" data-testid="create-user-modal" role="dialog" aria-label="新建用户">
        <div class="ant-modal-title">新建用户</div>
        <div class="ant-form ant-pro-form">
          <div class="ant-form-item" data-name="username">
            <label for="username">用户名</label>
            <div class="ant-form-item-control-input"><input id="username" name="username" placeholder="请输入用户名" /></div>
          </div>
          <div class="ant-form-item" data-name="role">
            <label>角色</label>
            <div class="ant-select ant-select-single" data-testid="role-select" role="combobox" aria-label="角色" tabindex="0">
              <div class="ant-select-selector"><span class="ant-select-selection-item">管理员</span></div>
            </div>
          </div>
        </div>
        <button class="ant-btn ant-btn-primary" data-testid="modal-confirm" type="button"><span>确定</span></button>
      </div>
      <div class="ant-select-dropdown" role="listbox">
        <div class="ant-select-item ant-select-item-option" role="option" title="管理员">管理员</div>
        <div class="ant-select-item ant-select-item-option" role="option" title="审计员">审计员</div>
      </div>
      <div class="ant-pro-table" data-testid="users-table">
        <div class="ant-pro-table-list-toolbar-title">用户列表</div>
        <div class="ant-table">
          <table>
            <thead><tr><th>用户名</th><th>角色</th><th>操作</th></tr></thead>
            <tbody>
              <tr class="ant-table-row" data-row-key="user-41"><td>Bob</td><td>访客</td><td class="ant-table-cell-fix-right"><button class="ant-btn" type="button"><span>编辑</span></button></td></tr>
              <tr class="ant-table-row" data-row-key="user-42"><td>Alice</td><td>管理员</td><td class="ant-table-cell-fix-right"><button class="ant-btn" type="button"><span>编辑</span></button></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
    <script>
      const modal = document.querySelector('[data-testid="create-user-modal"]');
      const dropdown = document.querySelector('.ant-select-dropdown');
      const roleText = document.querySelector('.ant-select-selection-item');
      document.querySelector('[data-testid="create-user-btn"]').addEventListener('click', () => modal.classList.add('open'));
      document.querySelector('[data-testid="role-select"]').addEventListener('click', () => dropdown.classList.add('open'));
      for (const option of document.querySelectorAll('[role="option"]')) {
        option.addEventListener('click', () => {
          roleText.textContent = option.textContent;
          dropdown.classList.remove('open');
        });
      }
      document.querySelector('[data-testid="modal-confirm"]').addEventListener('click', () => modal.classList.remove('open'));
    </script>
  </body>
</html>`;
}
