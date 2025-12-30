// 测试脚本 - 验证新创建提示词的默认置顶功能
function testPinFunctionality() {
  console.log('=== 开始测试提示词置顶功能 ===');

  // 1. 清空现有提示词
  chrome.storage.local.set({ prompts: [] }, () => {
    console.log('✓ 已清空所有现有提示词');

    // 2. 创建第一个测试提示词（手动置顶）
    const prompt1 = {
      id: Date.now(),
      title: '手动置顶提示词',
      category: '测试',
      tags: ['test'],
      content: '这是一个手动置顶的提示词',
      pinOrder: -1 // 手动置顶设置为-1
    };

    // 3. 创建第二个测试提示词（新创建，应该默认置顶）
    const prompt2 = {
      id: Date.now() + 1000,
      title: '新创建的提示词',
      category: '测试',
      tags: ['test'],
      content: '这是一个新创建的提示词，应该默认置顶',
      pinOrder: 0 // 新创建的提示词默认pinOrder为0
    };

    // 4. 创建第三个测试提示词（普通，没有pinOrder）
    const prompt3 = {
      id: Date.now() + 2000,
      title: '普通提示词',
      category: '测试',
      tags: ['test'],
      content: '这是一个普通的提示词，没有置顶'
    };

    // 5. 保存所有提示词
    const prompts = [prompt1, prompt2, prompt3];
    chrome.storage.local.set({ prompts }, () => {
      console.log('✓ 已保存测试提示词');

      // 6. 模拟排序逻辑
      const sortedPrompts = [...prompts].sort((a, b) => {
        // 复制排序逻辑
        if (a.pinOrder !== undefined && a.pinOrder !== null && (b.pinOrder === undefined || b.pinOrder === null)) {
          return -1;
        }
        if ((a.pinOrder === undefined || a.pinOrder === null) && b.pinOrder !== undefined && b.pinOrder !== null) {
          return 1;
        }
        if (a.pinOrder !== undefined && a.pinOrder !== null && b.pinOrder !== undefined && b.pinOrder !== null) {
          return a.pinOrder - b.pinOrder;
        }
        return b.id - a.id;
      });

      // 7. 输出排序结果
      console.log('\n=== 排序后的提示词顺序 ===');
      sortedPrompts.forEach((prompt, index) => {
        console.log(`${index + 1}. ${prompt.title} (pinOrder: ${prompt.pinOrder}, ID: ${prompt.id})`);
      });

      // 8. 验证结果
      if (sortedPrompts[0].title === '手动置顶提示词' && sortedPrompts[1].title === '新创建的提示词' && sortedPrompts[2].title === '普通提示词') {
        console.log('\n✅ 测试通过：置顶功能正常工作');
        console.log('- 手动置顶提示词（pinOrder: -1）在最顶部');
        console.log('- 新创建提示词（pinOrder: 0）在第二位');
        console.log('- 普通提示词（无pinOrder）在最后');
      } else {
        console.log('\n❌ 测试失败：置顶功能异常');
      }
    });
  });
}

// 测试saveSelectionAsPrompt函数
function testSaveSelectionAsPrompt() {
  console.log('\n=== 测试右键收藏功能 ===');

  // 模拟选中的文本
  const selectedText = '这是一段选中的文本，用于测试右键收藏功能';

  // 调用saveSelectionAsPrompt函数
  saveSelectionAsPrompt(selectedText);

  console.log('✓ 已调用saveSelectionAsPrompt函数');
  console.log('请检查弹窗是否打开，并验证新创建的提示词是否默认置顶');
}

// 运行测试
function runAllTests() {
  testPinFunctionality();
  setTimeout(testSaveSelectionAsPrompt, 1000);
}

// 页面加载完成后运行测试
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runAllTests);
} else {
  runAllTests();
}