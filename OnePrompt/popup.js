// Popup 页面脚本

// 加载统计信息
function loadStats() {
  chrome.storage.local.get(['prompts'], (result) => {
    const prompts = result.prompts || [];
    
    // 更新总数
    document.getElementById('total-count').textContent = prompts.length;
    
    // 统计分类数量
    const categories = new Set(prompts.map(p => p.category).filter(c => c));
    document.getElementById('category-count').textContent = categories.size;
  });
}

// 打开快捷键设置页面
document.getElementById('btn-open-shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  window.close();
});

// 管理提示词(在当前标签页打开侧边栏)
document.getElementById('btn-manage').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'togglePopup' });
      window.close();
    }
  });
});

// 导入CSV
document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(event) {
    const csv = event.target.result;
    const prompts = parseCSV(csv);
    
    if (prompts.length === 0) {
      alert('CSV文件为空或格式不正确');
      return;
    }

    chrome.storage.local.get(['prompts'], (result) => {
      const existingPrompts = result.prompts || [];
      const newPrompts = prompts.map(p => ({
        ...p,
        id: Date.now() + Math.random()
      }));
      
      const allPrompts = [...existingPrompts, ...newPrompts];
      chrome.storage.local.set({ prompts: allPrompts }, () => {
        alert(`成功导入 ${newPrompts.length} 条提示词`);
        loadStats();
      });
    });
  };
  
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
});

// 导出CSV
document.getElementById('btn-export').addEventListener('click', () => {
  chrome.storage.local.get(['prompts'], (result) => {
    const prompts = result.prompts || [];
    
    if (prompts.length === 0) {
      alert('没有可导出的提示词');
      return;
    }

    // 生成CSV内容
    let csv = '标题,类型,分类,标签,内容\n';
    
    prompts.forEach(prompt => {
      const title = escapeCSV(prompt.title);
      const type = escapeCSV(prompt.type || '');
      const category = escapeCSV(prompt.category || '');
      const tags = escapeCSV(prompt.tags ? prompt.tags.join('|') : '');
      const content = escapeCSV(prompt.content);
      
      csv += `${title},${type},${category},${tags},${content}\n`;
    });

    // 下载文件
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `one_prompts_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    
    alert(`成功导出 ${prompts.length} 条提示词`);
  });
});

// 解析CSV - 支持包含换行符的字段
function parseCSV(csv) {
  try {
    // 清理CSV内容
    csv = csv.replace(/^\uFEFF/, '').trim(); // 移除BOM和首尾空白
    if (!csv) return [];

    const prompts = [];
    let currentLine = [];
    let currentField = '';
    let inQuotes = false;
    let startRow = true;

    // 逐字符解析
    for (let i = 0; i < csv.length; i++) {
      const char = csv[i];
      const nextChar = csv[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // 转义的引号，添加一个引号
          currentField += '"';
          i++; // 跳过下一个引号
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // 字段分隔符
        currentLine.push(currentField);
        currentField = '';
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        // 行结束符
        if (!currentField.trim() && currentLine.length === 0) {
          // 跳过空行
          continue;
        }
        currentLine.push(currentField);
        
        // 跳过标题行
        if (startRow) {
          startRow = false;
        } else if (currentLine.length >= 2) {
          // 解析有效行
          prompts.push({
            title: currentLine[0].trim() || '未命名',
            type: currentLine[1] || '',
            category: currentLine[2] || '',
            tags: currentLine[3] ? currentLine[3].split('|').map(t => t.trim()).filter(t => t) : [],
            content: currentLine[4] || ''
          });
        }
        
        // 重置行和字段
        currentLine = [];
        currentField = '';
        
        // 跳过可能的\r\n组合
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
      } else {
        currentField += char;
      }
    }

    // 处理最后一行
    if (currentField || currentLine.length > 0) {
      currentLine.push(currentField);
      if (!startRow && currentLine.length >= 2) {
        prompts.push({
          title: currentLine[0].trim() || '未命名',
          type: currentLine[1] || '',
          category: currentLine[2] || '',
          tags: currentLine[3] ? currentLine[3].split('|').map(t => t.trim()).filter(t => t) : [],
          content: currentLine[4] || ''
        });
      }
    }
    
    return prompts;
  } catch (err) {
    console.error('CSV解析错误:', err);
    return [];
  }
}

// 不再需要单独的parseCSVLine函数，因为新的parseCSV已经整合了所有功能

function escapeCSV(str) {
  if (!str) return '""';
  str = String(str);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return '"' + str + '"';
}

// 清空所有提示词
document.getElementById('btn-clear-all').addEventListener('click', () => {
  if (!confirm('⚠️ 确定要移除所有提示词吗?\n\n此操作不可恢复!')) return;
  
  chrome.storage.local.set({ prompts: [] }, () => {
    alert('✅ 已移除所有提示词');
    loadStats();
  });
});

// 加载类型和分类到下拉选择框
function loadFilters() {
  chrome.storage.local.get(['prompts'], (result) => {
    const prompts = result.prompts || [];
    
    // 获取所有类型（去重）
    const types = [...new Set(prompts.map(p => p.type).filter(t => t))];
    const typeSelect = document.getElementById('delete-type-filter');
    
    // 清空现有选项（保留"所有类型"）
    while (typeSelect.children.length > 1) {
      typeSelect.removeChild(typeSelect.lastChild);
    }
    
    // 添加类型选项
    types.forEach(type => {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = type;
      typeSelect.appendChild(option);
    });
    
    // 获取所有分类（去重）
    const categories = [...new Set(prompts.map(p => p.category).filter(c => c))];
    const categorySelect = document.getElementById('delete-category-filter');
    
    // 清空现有选项（保留"所有分类"）
    while (categorySelect.children.length > 1) {
      categorySelect.removeChild(categorySelect.lastChild);
    }
    
    // 添加分类选项
    categories.forEach(category => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      categorySelect.appendChild(option);
    });
  });
}

// 移除选定的提示词
function removeSelectedPrompts() {
  const typeSelect = document.getElementById('delete-type-filter');
  const categorySelect = document.getElementById('delete-category-filter');
  
  const selectedType = typeSelect.value;
  const selectedCategory = categorySelect.value;
  
  if (!selectedType && !selectedCategory) {
    alert('请选择要删除的类型或分类');
    return;
  }
  
  chrome.storage.local.get(['prompts'], (result) => {
    const prompts = result.prompts || [];
    
    // 筛选要保留的提示词
    const promptsToKeep = prompts.filter(prompt => {
      const matchesType = !selectedType || prompt.type === selectedType;
      const matchesCategory = !selectedCategory || prompt.category === selectedCategory;
      return !(matchesType && matchesCategory);
    });
    
    const promptsToDelete = prompts.length - promptsToKeep.length;
    if (promptsToDelete === 0) {
      alert('没有找到匹配的提示词');
      return;
    }
    
    if (!confirm(`⚠️ 确定要移除${promptsToDelete}条匹配的提示词吗?\n\n此操作不可恢复!`)) return;
    
    chrome.storage.local.set({ prompts: promptsToKeep }, () => {
      alert(`✅ 已移除${promptsToDelete}条提示词`);
      loadStats();
      loadFilters(); // 重新加载筛选器
    });
  });
}

// 绑定移除操作事件
document.getElementById('btn-clear-selected').addEventListener('click', removeSelectedPrompts);

// 页面加载时更新统计和加载筛选器
loadStats();
loadFilters();
