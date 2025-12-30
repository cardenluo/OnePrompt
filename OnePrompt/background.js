// 后台服务脚本

// 监听快捷键命令
chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    
    if (command === 'toggle-popup') {
      // 打开/关闭提示词弹窗
      chrome.tabs.sendMessage(tabs[0].id, { action: 'togglePopup' });
    } else if (command === 'save-selection') {
      // 收藏选中文本为提示词
      chrome.tabs.sendMessage(tabs[0].id, { action: 'saveSelectionShortcut' });
    }
  });
});

// 创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  // 初始化存储
  chrome.storage.local.get(['prompts'], (result) => {
    if (!result.prompts) {
      // 初始化一些示例提示词
      const defaultPrompts = [
        {
          id: Date.now(),
          title: '代码优化专家',
          content: '请帮我优化以下代码,提高性能和可读性:\n\n',
          category: '编程',
          tags: ['代码', '优化']
        },
        {
          id: Date.now() + 1,
          title: '文案创作',
          content: '请帮我创作一段关于以下主题的文案:\n\n',
          category: '写作',
          tags: ['文案', '创作']
        }
      ];
      chrome.storage.local.set({ prompts: defaultPrompts });
    }
  });

  // 创建右键菜单
  chrome.contextMenus.create({
    id: 'save-selection',
    title: '保存到OnePrompt',
    contexts: ['selection']
  });
});

// 监听右键菜单点击
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'save-selection' && info.selectionText) {
    // 发送选中的文本到content script
    chrome.tabs.sendMessage(tab.id, {
      action: 'saveSelection',
      text: info.selectionText
    });
  }
});
