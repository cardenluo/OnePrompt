// 内容脚本 - 在豆包页面中注入

let isPopupOpen = false;
let popupContainer = null;
let isPinned = false; // 固定状态
let lastFocusedInput = null; // 记录最后获得焦点的输入框

// 新弹窗相关变量
let isQuickPopupOpen = false;
let quickPopupContainer = null;
let quickPopupInput = null; // 当前激活的输入框
let inputCommand = ''; // 记录输入的命令

// 页面加载完成后添加焦点监听器
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('focus', handleInputFocus, true);
  initTheme();
});

// 页面卸载时移除焦点监听器
window.addEventListener('pagehide', () => {
  document.removeEventListener('focus', handleInputFocus, true);
});

// 监听来自background的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'togglePopup') {
    // 判断当前是否有输入框焦点
    const hasInputFocus = document.activeElement &&
      (document.activeElement.tagName === 'INPUT' ||
        document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.isContentEditable ||
        document.activeElement.getAttribute('role') === 'textbox');

    if (hasInputFocus) {
      toggleQuickPopup(); // 有输入框焦点时使用快速弹窗
    } else {
      togglePopup(); // 没有输入框焦点时使用侧边栏
    }
  } else if (request.action === 'saveSelection') {
    // 右键收藏选中文本
    saveSelectionAsPrompt(request.text);
  } else if (request.action === 'saveSelectionShortcut') {
    // 快捷键收藏选中文本
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      saveSelectionAsPrompt(selectedText);
    } else {
      showToast('❌ 未选中文本');
    }
  }
});

// 切换弹窗显示/隐藏
function togglePopup() {
  if (isPopupOpen) {
    closePopup();
  } else {
    openPopup();
  }
}

// 切换快速弹窗显示/隐藏
function toggleQuickPopup() {
  if (isQuickPopupOpen) {
    closeQuickPopup();
  } else {
    // 确保当前有焦点的输入框
    if (document.activeElement &&
      (document.activeElement.tagName === 'INPUT' ||
        document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.isContentEditable ||
        document.activeElement.getAttribute('role') === 'textbox')) {
      quickPopupInput = document.activeElement;
      openQuickPopup();
    } else {
      showToast('❌ 请先点击输入框');
    }
  }
}

// 打开快速弹窗
function openQuickPopup() {
  if (quickPopupContainer) {
    quickPopupContainer.style.display = 'block';
    isQuickPopupOpen = true;
    loadQuickPopupPrompts();

    // 确保已存在的快速弹窗应用当前主题
    chrome.storage.local.get(['theme'], (result) => {
      const theme = result.theme || 'light';
      applyTheme(theme);
    });

    // 重新绑定事件（确保搜索框等功能正常）
    bindQuickPopupEvents();

    return;
  }

  // 创建快速弹窗容器
  quickPopupContainer = document.createElement('div');
  quickPopupContainer.id = 'doubao-prompt-quick-popup';
  quickPopupContainer.innerHTML = `
    <div class="quick-popup-content">
      <div class="quick-popup-header">
        <input type="text" id="quick-search-input" placeholder="🔍 输入关键词搜索提示词..." />
        <select id="quick-all-type" class="select-all-type">
          <option value="">所有类型</option>
        </select>
        <button class="btn-close-icon" id="quick-popup-close">✕</button>
      </div>
      
      <div class="quick-popup-body">
        <div class="quick-category-tags" id="quick-category-tags">
          <!-- 分类标签将动态加载 -->
        </div>
        
        <div class="quick-prompts-list" id="quick-prompts-list">
          <!-- 提示词列表将动态加载 -->
        </div>
      </div>
    </div>
    
    <!-- 文本编辑对话框 -->
    <div class="edit-dialog" id="edit-dialog" style="display: none;">
      <div class="edit-dialog-content">
        <div class="edit-dialog-header">
          <h3>编辑提示词</h3>
          <button class="btn-close-icon" id="edit-dialog-close">✕</button>
        </div>
        <div class="edit-dialog-body">
          <div class="form-group">
            <label>标题</label>
            <input type="text" id="quick-prompt-title" />
          </div>
          <div class="form-group">
            <label>类型</label>
            <input type="text" id="quick-prompt-type" placeholder="例如: 工作、学习、生活" />
          </div>
          <div class="form-group">
            <label>前置提示词</label>
            <textarea id="pre-prompt" rows="2" style="height: 40px; min-height: 40px; max-height: none;"></textarea>
          </div>
          <div class="form-group">
            <label>系统提示词</label>
            <textarea id="system-prompt" rows="10" style="height: 200px; min-height: 200px; max-height: none;"></textarea>
          </div>
          <div class="form-group">
            <label>后置提示词</label>
            <textarea id="user-prompt" rows="2" style="height: 40px; min-height: 40px; max-height: none;"></textarea>
          </div>
        </div>
        <div class="edit-dialog-footer">
          <button class="btn-edit-cancel" id="btn-edit-cancel">取消</button>
          <button class="btn-edit-confirm" id="btn-edit-confirm">采用</button>
        </div>
      </div>
    </div>
  `;

  // 添加样式
  document.body.appendChild(quickPopupContainer);
  isQuickPopupOpen = true;

  // 确保快速弹窗应用当前主题
  chrome.storage.local.get(['theme'], (result) => {
    const theme = result.theme || 'light';
    applyTheme(theme);
  });

  loadQuickPopupPrompts();
  bindQuickPopupEvents();
}

// 关闭快速弹窗
function closeQuickPopup() {
  if (quickPopupContainer) {
    quickPopupContainer.style.display = 'none';
    isQuickPopupOpen = false;
  }
}

// 显示编辑对话框
function showEditDialog(id) {
  chrome.storage.local.get(['prompts'], (result) => {
    const prompts = result.prompts || [];
    const prompt = prompts.find(p => p.id === id);

    if (prompt) {
      const titleInput = document.getElementById('quick-prompt-title');
      const typeInput = document.getElementById('quick-prompt-type');
      const prePromptTextarea = document.getElementById('pre-prompt');
      const systemPromptTextarea = document.getElementById('system-prompt');
      const userPromptTextarea = document.getElementById('user-prompt');

      if (titleInput && typeInput && prePromptTextarea && systemPromptTextarea && userPromptTextarea) {
        // 快速弹窗中的编辑：隐藏标题和类型字段
        titleInput.parentElement.style.display = 'none';
        typeInput.parentElement.style.display = 'none';

        prePromptTextarea.value = ''; // 前置提示词默认为空
        // 系统提示词可编辑（移除readonly属性）
        systemPromptTextarea.removeAttribute('readonly');
        systemPromptTextarea.style.backgroundColor = '';
        systemPromptTextarea.value = prompt.content;
        userPromptTextarea.value = ''; // 后置提示词默认为空

        const editDialog = document.getElementById('edit-dialog');
        if (editDialog) {
          editDialog.style.display = 'flex';
        }
      }
    }
  });
}

// 隐藏编辑对话框
function hideEditDialog() {
  const editDialog = document.getElementById('edit-dialog');
  if (editDialog) {
    editDialog.style.display = 'none';

    // 重置字段显示状态（为侧边栏编辑做准备）
    const titleInput = document.getElementById('quick-prompt-title');
    const typeInput = document.getElementById('quick-prompt-type');
    if (titleInput && typeInput) {
      titleInput.parentElement.style.display = 'block';
      typeInput.parentElement.style.display = 'block';
    }
  }
}

// 确认编辑对话框
function confirmEditDialog() {
  const titleInput = document.getElementById('quick-prompt-title');
  const typeInput = document.getElementById('quick-prompt-type');
  const prePromptTextarea = document.getElementById('pre-prompt');
  const systemPromptTextarea = document.getElementById('system-prompt');
  const userPromptTextarea = document.getElementById('user-prompt');

  if (titleInput && typeInput && prePromptTextarea && systemPromptTextarea && userPromptTextarea && quickPopupInput) {
    const title = titleInput.value.trim();
    const type = typeInput.value.trim();
    const prePrompt = prePromptTextarea.value.trim();
    const systemPrompt = systemPromptTextarea.value;
    const userPrompt = userPromptTextarea.value.trim();

    // 按照要求合并：前置提示词 + "。" + 系统提示词 + "。" + 后置提示词
    const combinedPrompt = prePrompt + '。' + systemPrompt + '。' + userPrompt;

    // 插入到当前输入框
    const success = insertTextToDoubao(quickPopupInput, combinedPrompt);
    if (success) {
      // 更新提示词信息
      if (title || type) {
        chrome.storage.local.get(['prompts'], (result) => {
          const prompts = result.prompts || [];
          const prompt = prompts.find(p => p.content === systemPrompt);
          if (prompt) {
            if (title) prompt.title = title;
            if (type) prompt.type = type;
            chrome.storage.local.set({ prompts });
          }
        });
      }

      showToast('✅ 已插入提示词');
      hideEditDialog();
      closeQuickPopup();
    } else {
      showToast('❌ 插入失败');
    }
  }
}

// 绑定快速弹窗事件
function bindQuickPopupEvents() {
  // 关闭按钮
  const closeBtn = document.getElementById('quick-popup-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeQuickPopup);
  }

  // 所有类型下拉框
  const allTypeSelect = document.getElementById('quick-all-type');
  if (allTypeSelect) {
    allTypeSelect.addEventListener('change', (e) => {
      const selectedType = e.target.value;
      selectedTypes.clear();
      if (selectedType) {
        selectedTypes.add(selectedType);
      }
      selectedCategories.clear(); // 清空二级分类选择
      loadQuickPopupPrompts();
    });
  }

  // 搜索输入
  const searchInput = document.getElementById('quick-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      loadQuickPopupPrompts();
    });
  }

  // 点击外部关闭
  quickPopupContainer.addEventListener('click', (e) => {
    if (e.target === quickPopupContainer) {
      closeQuickPopup();
    }
  });

  // 编辑对话框事件绑定
  const editDialogCloseBtn = document.getElementById('edit-dialog-close');
  const btnEditCancel = document.getElementById('btn-edit-cancel');
  const btnEditConfirm = document.getElementById('btn-edit-confirm');

  if (editDialogCloseBtn) {
    editDialogCloseBtn.addEventListener('click', hideEditDialog);
  }

  if (btnEditCancel) {
    btnEditCancel.addEventListener('click', hideEditDialog);
  }

  if (btnEditConfirm) {
    btnEditConfirm.addEventListener('click', confirmEditDialog);
  }
}

// 加载快速弹窗的提示词
function loadQuickPopupPrompts() {
  chrome.storage.local.get(['prompts'], (result) => {
    const prompts = result.prompts || [];
    updateQuickTypeAndCategoryFilter(prompts);
    filterQuickPopupPrompts(prompts); // 传递提示词数组，避免重复获取
  });
}

// 当前选中的类型
let selectedTypes = new Set();
// 当前选中的分类（支持多选）
let selectedCategories = new Set();

// 更新快速弹窗的类型和分类标签
function updateQuickTypeAndCategoryFilter(prompts) {
  const typeSelect = document.getElementById('quick-all-type');
  const categoryContainer = document.getElementById('quick-category-tags');

  if (!typeSelect) return;

  // 获取所有类型
  const types = new Set(prompts.map(p => p.type).filter(t => t));
  const sortedTypes = Array.from(types).sort();

  // 更新类型下拉框选项
  const currentTypeValue = typeSelect.value;
  typeSelect.innerHTML = '<option value="">所有类型</option>';
  sortedTypes.forEach(type => {
    const safeType = escapeHtml(String(type));
    const option = document.createElement('option');
    option.value = safeType;
    option.textContent = safeType;
    typeSelect.appendChild(option);
  });
  // 恢复选中状态
  if (currentTypeValue && sortedTypes.includes(currentTypeValue)) {
    typeSelect.value = currentTypeValue;
  }

  // 更新分类标签（基于当前选择的类型）
  if (categoryContainer) {
    let filteredPrompts = prompts;

    // 如果选择了类型，先按类型过滤
    if (selectedTypes.size > 0) {
      filteredPrompts = prompts.filter(p => p.type && selectedTypes.has(p.type));
    }

    // 获取过滤后的所有分类
    const categories = new Set(filteredPrompts.map(p => p.category).filter(c => c));
    const sortedCategories = Array.from(categories).sort();

    // 构建分类标签
    const categoryTags = sortedCategories.map(category => {
      const safeCategory = escapeHtml(String(category));
      const isActive = selectedCategories.has(safeCategory);
      return `<button class="category-tag ${isActive ? 'active' : ''}" data-category="${safeCategory}">${safeCategory}</button>`;
    }).join('');

    categoryContainer.innerHTML = categoryTags;

    // 绑定分类标签点击事件 - 多选追加模式
    categoryContainer.querySelectorAll('.category-tag').forEach(tag => {
      tag.addEventListener('click', (e) => {
        const category = tag.dataset.category;

        // 切换分类选择（追加模式）
        if (selectedCategories.has(category)) {
          selectedCategories.delete(category);
        } else {
          selectedCategories.add(category);
        }

        // 重新加载以更新标签状态和筛选结果
        loadQuickPopupPrompts();
      });
    });
  }
}

// 渲染快速弹窗的提示词列表
function renderQuickPopupPrompts(prompts) {
  const listContainer = document.getElementById('quick-prompts-list');

  if (!listContainer) {
    console.error('快速弹窗列表容器不存在');
    return;
  }

  if (prompts.length === 0) {
    listContainer.innerHTML = '<div class="empty-state">暂无提示词</div>';
    return;
  }

  const items = [];

  prompts.forEach(prompt => {
    try {
      // 安全地处理可能的乱码
      const safeId = prompt.id || Date.now() + Math.random();
      const safeTitle = escapeHtml(String(prompt.title || '未命名'));
      const safeType = prompt.type ? escapeHtml(String(prompt.type)) : '';
      const safeContent = escapeHtml(String(prompt.content || '').substring(0, 80));
      const safeCategory = prompt.category ? escapeHtml(String(prompt.category)) : '';
      const safeTags = prompt.tags ? prompt.tags.map(t => escapeHtml(String(t))).slice(0, 3) : [];

      const tagsHtml = safeTags.length > 0
        ? safeTags.map(tag => `<span class="quick-tag">#${tag}</span>`).join('')
        : '';

      const item = `
        <div class="quick-prompt-item" data-id="${safeId}">
          <div class="quick-prompt-header-row">
            <div class="quick-prompt-clickable" data-prompt-id="${safeId}">
              <h4 class="quick-prompt-title">${safeTitle}</h4>
              <div class="quick-prompt-preview">${safeContent}${(prompt.content || '').length > 80 ? '...' : ''}</div>
            </div>
            <div class="quick-prompt-actions">
              <button class="btn-quick-icon btn-quick-pin" data-prompt-id="${safeId}" title="置顶">📌</button>
              <button class="btn-quick-icon btn-quick-edit" data-prompt-id="${safeId}" title="编辑">✏️</button>
              <button class="btn-quick-icon btn-quick-copy" data-prompt-id="${safeId}" title="复制">📋</button>
            </div>
          </div>
          <div class="quick-prompt-meta">
            ${safeType ? `<span class="quick-prompt-type">${safeType}</span>` : ''}
            ${safeCategory ? `<span class="quick-prompt-category">${safeCategory}</span>` : ''}
            ${tagsHtml}
          </div>
        </div>
      `;
      items.push(item);
    } catch (err) {
      console.error('渲染快速弹窗提示词出错:', err, prompt);
    }
  });

  listContainer.innerHTML = items.join('');

  // 绑定点击标题或内容插入
  listContainer.querySelectorAll('.quick-prompt-clickable').forEach(clickable => {
    clickable.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const id = clickable.dataset.promptId;
        if (id) {
          selectQuickPrompt(parseFloat(id));
        }
      } catch (err) {
        console.error('选择快速弹窗提示词失败:', err);
        showToast('❌ 操作失败');
      }
    });
  });

  // 绑定编辑按钮点击事件
  listContainer.querySelectorAll('.btn-quick-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const id = btn.dataset.promptId;
        if (id) {
          showEditDialog(parseFloat(id));
        }
      } catch (err) {
        console.error('编辑快速弹窗提示词失败:', err);
        showToast('❌ 编辑失败');
      }
    });
  });

  // 绑定复制按钮点击事件
  listContainer.querySelectorAll('.btn-quick-copy').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const id = btn.dataset.promptId;
        if (id) {
          copyQuickPrompt(parseFloat(id));
        }
      } catch (err) {
        console.error('复制快速弹窗提示词失败:', err);
        showToast('❌ 复制失败');
      }
    });
  });

  // 绑定置顶按钮点击事件
  listContainer.querySelectorAll('.btn-quick-pin').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const id = btn.dataset.promptId;
        if (id) {
          togglePinPrompt(parseFloat(id));
        }
      } catch (err) {
        console.error('置顶快速弹窗提示词失败:', err);
        showToast('❌ 置顶失败');
      }
    });
  });
}

// 过滤快速弹窗的提示词
function filterQuickPopupPrompts(prompts = null) {
  const searchTerm = document.getElementById('quick-search-input').value.toLowerCase();

  // 如果没有传递提示词数组，则从存储中获取
  if (prompts === null) {
    chrome.storage.local.get(['prompts'], (result) => {
      filterQuickPopupPrompts(result.prompts || []);
    });
    return;
  }

  const filtered = prompts.filter(p => {
    // 类型筛选
    const matchesType = selectedTypes.size === 0 ||
      (p.type && selectedTypes.has(p.type));

    // 分类筛选
    const matchesCategory = selectedCategories.size === 0 ||
      (p.category && selectedCategories.has(p.category));

    // 搜索关键词筛选
    if (!searchTerm) {
      return matchesType && matchesCategory;
    }

    // 将搜索词按空格、英文逗号、中文逗号拆分，并过滤掉空字符串
    const searchTerms = searchTerm.split(/[\s,，]+/).filter(term => term.trim() !== '');

    // 检查提示词是否包含所有搜索关键词
    const matchesAllSearchTerms = searchTerms.every(term => {
      return (p.title && p.title.toLowerCase().includes(term)) ||
        (p.content && p.content.toLowerCase().includes(term)) ||
        (p.type && p.type.toLowerCase().includes(term)) ||
        (p.category && p.category.toLowerCase().includes(term)) ||
        (p.tags && p.tags.some(tag => tag.toLowerCase().includes(term)));
    });

    return matchesType && matchesCategory && matchesAllSearchTerms;
  });

  // 对筛选后的提示词进行排序，确保有pinOrder的提示词排在前面
  filtered.sort((a, b) => {
    // 有pinOrder的提示词排在前面
    if (a.pinOrder !== undefined && a.pinOrder !== null && (b.pinOrder === undefined || b.pinOrder === null)) {
      return -1;
    }
    if ((a.pinOrder === undefined || a.pinOrder === null) && b.pinOrder !== undefined && b.pinOrder !== null) {
      return 1;
    }
    // 都有pinOrder的话，按pinOrder升序排列，pinOrder相同则按ID降序排列
    if (a.pinOrder !== undefined && a.pinOrder !== null && b.pinOrder !== undefined && b.pinOrder !== null) {
      if (a.pinOrder !== b.pinOrder) {
        return a.pinOrder - b.pinOrder;
      }
      return b.id - a.id;
    }
    // 都没有pinOrder的话，按ID降序排列（最新的在前）
    return b.id - a.id;
  });

  renderQuickPopupPrompts(filtered);
}

// 选择快速弹窗中的提示词
function selectQuickPrompt(id) {
  chrome.storage.local.get(['prompts'], (result) => {
    const prompts = result.prompts || [];
    const prompt = prompts.find(p => p.id === id);

    if (prompt && quickPopupInput) {
      // 将提示词内容插入到当前输入框
      const success = insertTextToDoubao(quickPopupInput, prompt.content);
      if (success) {
        showToast('✅ 已插入提示词');
        closeQuickPopup();
      } else {
        showToast('❌ 插入失败');
      }
    }
  });
}

// 复制快速弹窗中的提示词
function copyQuickPrompt(id) {
  chrome.storage.local.get(['prompts'], (result) => {
    const prompts = result.prompts || [];
    const prompt = prompts.find(p => p.id === id);

    if (prompt) {
      navigator.clipboard.writeText(prompt.content).then(() => {
        showToast('✅ 已复制到剪贴板');
      }).catch(err => {
        console.error('复制失败:', err);
        showToast('❌ 复制失败');
      });
    }
  });
}

// 提示词置顶功能 - 点击就置顶，最后点击的为置顶
function togglePinPrompt(id) {
  chrome.storage.local.get(['prompts'], (result) => {
    let prompts = result.prompts || [];
    const promptIndex = prompts.findIndex(p => p.id === id);

    if (promptIndex === -1) {
      showToast('❌ 未找到提示词');
      return;
    }

    // 为当前点击的提示词设置最小的pinOrder值，确保它排在第一位
    const prompt = prompts[promptIndex];

    // 找到当前最小的pinOrder值
    let minPinOrder = 0;
    prompts.forEach(p => {
      if (p.pinOrder !== undefined && p.pinOrder !== null && p.pinOrder < minPinOrder) {
        minPinOrder = p.pinOrder;
      }
    });

    // 设置当前点击的提示词的pinOrder为比最小的还小1
    prompt.pinOrder = minPinOrder - 1;
    showToast('✅ 已置顶');

    // 重新排序提示词
    prompts.sort((a, b) => {
      // 首先比较pinOrder是否存在且不为null
      const aHasPin = a.pinOrder !== undefined && a.pinOrder !== null;
      const bHasPin = b.pinOrder !== undefined && b.pinOrder !== null;

      if (aHasPin && !bHasPin) {
        return -1; // a有pinOrder，b没有，a排在前面
      }
      if (!aHasPin && bHasPin) {
        return 1; // b有pinOrder，a没有，b排在前面
      }
      if (aHasPin && bHasPin) {
        return a.pinOrder - b.pinOrder; // 都有pinOrder，按数值升序排列（越小越靠前）
      }
      // 都没有pinOrder，按ID降序排列（最新的在前）
      return b.id - a.id;
    });

    // 保存到存储
    chrome.storage.local.set({ prompts }, () => {
      // 重新渲染列表
      if (isQuickPopupOpen) {
        loadQuickPopupPrompts();
      }
      if (isPopupOpen) {
        loadPrompts();
      }
    });
  });
}

// 记录最后获得焦点的输入框
function handleInputFocus(event) {
  const element = event.target;
  // 检查是否是有效的输入元素
  const isInput = (element.tagName === 'INPUT' && (element.type === 'text' || element.type === 'search' || element.type === 'email' || element.type === 'number' || element.type === 'url')) ||
    element.tagName === 'TEXTAREA' ||
    element.isContentEditable ||
    element.getAttribute('role') === 'textbox';

  // 检查是否可见
  if (isInput) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 100 && rect.height > 20 && element.offsetParent !== null) {
      lastFocusedInput = element;
      // 添加键盘事件监听
      element.addEventListener('keydown', handleInputKeydown);
    }
  }
}

// 处理输入框的键盘事件
function handleInputKeydown(event) {
  const element = event.target;
  let currentText = '';

  // 获取当前输入框的内容
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    currentText = element.value;
  } else if (element.isContentEditable || element.getAttribute('role') === 'textbox') {
    currentText = element.textContent;
  }

  // 检测自定义命令
  const commands = ['/P', '@@'];
  let commandDetected = false;

  for (const command of commands) {
    if (currentText.endsWith(command)) {
      // 检测到命令，打开快速弹窗
      event.preventDefault();
      commandDetected = true;

      // 移除已输入的命令字符
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        element.value = currentText.slice(0, -command.length);
        // 设置光标位置
        element.setSelectionRange(element.value.length, element.value.length);
      } else if (element.isContentEditable || element.getAttribute('role') === 'textbox') {
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(element);
        range.collapse(false);
        range.setStart(range.startContainer, range.startOffset - command.length);
        range.deleteContents();
      }

      // 打开快速弹窗
      quickPopupInput = element;
      openQuickPopup();
      break;
    }
  }

  // 如果检测到ESC键，关闭快速弹窗
  if (event.key === 'Escape' && isQuickPopupOpen) {
    closeQuickPopup();
  }
}

// 打开弹窗
function openPopup() {
  if (popupContainer) {
    popupContainer.style.display = 'flex';
    isPopupOpen = true;
    loadPrompts();

    // 确保已存在的侧边栏弹窗应用当前主题
    chrome.storage.local.get(['theme'], (result) => {
      const theme = result.theme || 'light';
      applyTheme(theme);
    });

    return;
  }

  // 创建弹窗容器
  popupContainer = document.createElement('div');
  popupContainer.id = 'doubao-prompt-popup';
  popupContainer.innerHTML = `
    <div class="popup-overlay" id="popup-overlay"></div>
    <div class="popup-content">
      <div class="popup-header">
        <h2>积木OnePrompt</h2>
        <div class="header-actions">
          <button class="btn-theme-toggle" id="btn-theme-toggle" title="切换主题">💡</button>
          <button class="btn-add" id="btn-add">+创建</button>
          <button class="btn-close" id="btn-close">✕</button>
        </div>
      </div>
      
      <div class="popup-body">
        <div class="sidebar-search-row">
          <input type="text" id="search-input" placeholder="🔍 输入关键词搜索提示词..." />
          <select id="type-filter" class="sidebar-all-type">
            <option value="">所有类型</option>
          </select>
        </div>
        
        <div class="sidebar-category-tags" id="sidebar-category-tags">
          <!-- 分类标签将动态加载 -->
        </div>
        
        <div class="prompts-list" id="prompts-list">
          <!-- 提示词列表将动态加载 -->
        </div>
      </div>
    </div>
    
    <!-- 编辑/新建提示词模态框 -->
    <div class="modal" id="edit-modal" style="display: none;">
      <div class="modal-content">
        <h3 id="modal-title">新建提示词</h3>
        <form id="prompt-form">
          <div class="form-group">
            <label>标题</label>
            <input type="text" id="prompt-title" required />
          </div>
          <div class="form-group">
            <label>类型</label>
            <input type="text" id="prompt-type" placeholder="例如: 工作、学习、生活" />
          </div>
          <div class="form-group">
            <label>分类</label>
            <input type="text" id="prompt-category" placeholder="例如: 编程、写作、翻译" />
          </div>
          <div class="form-group">
            <label>标签</label>
            <input type="text" id="prompt-tags" placeholder="用逗号分隔,例如: 代码,优化" />
          </div>
          <div class="form-group">
            <label>提示词内容</label>
            <textarea id="prompt-content" rows="8" required></textarea>
          </div>
          <div class="form-actions">
            <button type="button" class="btn-cancel" id="btn-modal-cancel">取消</button>
            <button type="submit" class="btn-save">保存</button>
          </div>
        </form>
      </div>
    </div>
    
    <input type="file" id="csv-file-input" accept=".csv" style="display: none;" />
  `;

  document.body.appendChild(popupContainer);
  isPopupOpen = true;
  isPinned = true; // 默认固定

  // 确保侧边栏弹窗应用当前主题
  chrome.storage.local.get(['theme'], (result) => {
    const theme = result.theme || 'light';
    applyTheme(theme);
  });

  // 设置为固定模式
  const overlay = document.getElementById('popup-overlay');
  overlay.style.pointerEvents = 'none';
  overlay.style.background = 'transparent';
  popupContainer.style.pointerEvents = 'auto';
  popupContainer.style.width = '450px';
  popupContainer.style.height = '100vh';
  popupContainer.style.justifyContent = 'flex-end';

  // 绑定事件
  bindEvents();
  loadPrompts();
}

// 关闭弹窗
function closePopup() {
  if (popupContainer) {
    popupContainer.style.display = 'none';
    isPopupOpen = false;
  }
}



// 当前选中的类型（侧边栏）
let sidebarSelectedTypes = new Set();
// 当前选中的分类（侧边栏，支持多选）
let sidebarSelectedCategories = new Set();

// 绑定事件处理
function bindEvents() {
  // 关闭按钮
  document.getElementById('btn-close').addEventListener('click', closePopup);

  // 新建按钮
  document.getElementById('btn-add').addEventListener('click', () => {
    showEditModal();
  });

  // 搜索
  document.getElementById('search-input').addEventListener('input', (e) => {
    filterPrompts();
  });

  // 类型筛选下拉框
  document.getElementById('type-filter').addEventListener('change', (e) => {
    const selectedType = e.target.value;
    sidebarSelectedTypes.clear();
    if (selectedType) {
      sidebarSelectedTypes.add(selectedType);
    }
    sidebarSelectedCategories.clear(); // 清空二级分类选择
    loadPrompts();
  });

  // 模态框取消
  document.getElementById('btn-modal-cancel').addEventListener('click', hideEditModal);

  // 表单提交
  document.getElementById('prompt-form').addEventListener('submit', savePrompt);

  // 主题切换按钮
  const themeToggleBtn = document.getElementById('btn-theme-toggle');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  }
}

// 切换主题函数
function toggleTheme() {
  // 获取当前主题
  chrome.storage.local.get(['theme'], (result) => {
    const currentTheme = result.theme || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';

    // 保存新主题
    chrome.storage.local.set({ theme: newTheme });

    // 应用主题
    applyTheme(newTheme);
  });
}

// 应用主题函数
function applyTheme(theme) {
  // 更新侧边栏弹窗主题
  const popup = document.getElementById('doubao-prompt-popup');
  if (popup) {
    popup.classList.remove('theme-light', 'theme-dark');
    popup.classList.add(`theme-${theme}`);
  }

  // 更新快速弹窗主题
  const quickPopup = document.getElementById('doubao-prompt-quick-popup');
  if (quickPopup) {
    quickPopup.classList.remove('theme-light', 'theme-dark');
    quickPopup.classList.add(`theme-${theme}`);
  }

  // 更新编辑对话框主题
  const editDialog = document.getElementById('edit-dialog');
  if (editDialog) {
    editDialog.classList.remove('theme-light', 'theme-dark');
    editDialog.classList.add(`theme-${theme}`);
  }

  // 更新所有主题切换按钮的图标
  const themeToggleBtns = document.querySelectorAll('.btn-theme-toggle');
  themeToggleBtns.forEach(btn => {
    btn.textContent = theme === 'light' ? '💡' : '🌙';
  });
}

// 初始化主题
function initTheme() {
  chrome.storage.local.get(['theme'], (result) => {
    const theme = result.theme || 'light';
    applyTheme(theme);
  });
}

// 加载提示词列表
function loadPrompts() {
  chrome.storage.local.get(['prompts'], (result) => {
    const prompts = result.prompts || [];
    updateTypeAndCategoryFilter(prompts);
    filterPrompts(prompts); // 传递提示词数组，避免重复获取
  });
}

// 更新类型和分类筛选器
function updateTypeAndCategoryFilter(prompts) {
  const typeFilter = document.getElementById('type-filter');
  const categoryTagsContainer = document.getElementById('sidebar-category-tags');

  if (!typeFilter) return;

  // 获取所有类型
  const types = new Set();
  prompts.forEach(prompt => {
    if (prompt.type && prompt.type.trim()) {
      const safeType = sanitizeText(String(prompt.type));
      if (safeType) {
        types.add(safeType);
      }
    }
  });

  // 保存当前选中的类型
  const currentTypeValue = typeFilter.value;

  // 更新类型下拉框
  typeFilter.innerHTML = '<option value="">所有类型</option>';
  const sortedTypes = Array.from(types).sort();
  sortedTypes.forEach(type => {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    typeFilter.appendChild(option);
  });

  // 恢复选中状态
  if (currentTypeValue && sortedTypes.includes(currentTypeValue)) {
    typeFilter.value = currentTypeValue;
  }

  // 更新分类标签（基于当前选择的类型）
  if (categoryTagsContainer) {
    let filteredPrompts = prompts;

    // 如果选择了类型，先按类型过滤
    if (sidebarSelectedTypes.size > 0) {
      filteredPrompts = prompts.filter(p => p.type && sidebarSelectedTypes.has(p.type));
    }

    // 获取过滤后的所有分类
    const categories = new Set();
    filteredPrompts.forEach(prompt => {
      if (prompt.category && prompt.category.trim()) {
        const safeCategory = sanitizeText(String(prompt.category));
        if (safeCategory) {
          categories.add(safeCategory);
        }
      }
    });

    const sortedCategories = Array.from(categories).sort();
    const categoryTags = sortedCategories.map(category => {
      const safeCategory = escapeHtml(String(category));
      const isActive = sidebarSelectedCategories.has(safeCategory);
      return `<button class="sidebar-category-tag ${isActive ? 'active' : ''}" data-category="${safeCategory}">${safeCategory}</button>`;
    }).join('');

    categoryTagsContainer.innerHTML = categoryTags;

    // 绑定分类标签点击事件
    categoryTagsContainer.querySelectorAll('.sidebar-category-tag').forEach(tag => {
      tag.addEventListener('click', (e) => {
        const category = tag.dataset.category;

        // 切换分类选择（追加模式）
        if (sidebarSelectedCategories.has(category)) {
          sidebarSelectedCategories.delete(category);
        } else {
          sidebarSelectedCategories.add(category);
        }

        // 重新加载以更新标签状态和筛选结果
        loadPrompts();
      });
    });
  }
}

// 渲染提示词列表 - 防止乱码导致渲染失败
function renderPrompts(prompts) {
  const listContainer = document.getElementById('prompts-list');

  if (!listContainer) {
    console.error('列表容器不存在');
    return;
  }

  if (prompts.length === 0) {
    listContainer.innerHTML = '<div class="empty-state">暂无提示词,点击"新建提示词"开始创建</div>';
    return;
  }

  const items = [];

  prompts.forEach(prompt => {
    try {
      // 安全地处理可能的乱码
      const safeId = prompt.id || Date.now() + Math.random();
      const safeTitle = escapeHtml(String(prompt.title || '未命名'));
      const safeType = prompt.type ? escapeHtml(String(prompt.type)) : '';
      const safeContent = escapeHtml(String(prompt.content || '').substring(0, 80));
      const safeCategory = prompt.category ? escapeHtml(String(prompt.category)) : '';
      const safeTags = prompt.tags ? prompt.tags.map(t => escapeHtml(String(t))).slice(0, 3) : [];

      const tagsHtml = safeTags.length > 0
        ? safeTags.map(tag => `<span class="sidebar-tag">#${tag}</span>`).join('')
        : '';

      const item = `
        <div class="prompt-item" data-id="${safeId}">
          <div class="prompt-header">
            <h4>${safeTitle}</h4>
            <div class="prompt-actions">
              <button class="btn-sidebar-icon btn-sidebar-pin" data-prompt-id="${safeId}" title="置顶">📌</button>
              <button class="btn-sidebar-icon btn-sidebar-edit" data-prompt-id="${safeId}" title="编辑">✏️</button>
              <button class="btn-sidebar-icon btn-sidebar-delete" data-prompt-id="${safeId}" title="删除">🗑️</button>
            </div>
          </div>
          <div class="prompt-preview">${safeContent}${(prompt.content || '').length > 80 ? '...' : ''}</div>
          <div class="prompt-meta">
            ${safeType ? `<span class="sidebar-prompt-type">${safeType}</span>` : ''}
            ${safeCategory ? `<span class="sidebar-prompt-category">${safeCategory}</span>` : ''}
            ${tagsHtml}
          </div>
        </div>
      `;
      items.push(item);
    } catch (err) {
      console.error('渲染提示词出错:', err, prompt);
      // 即使单个提示词出错,也添加一个可删除的占位符
      items.push(`
        <div class="prompt-item" data-id="${prompt.id || 'error'}">
          <div class="prompt-header">
            <h4>⚠️ 数据异常</h4>
            <div class="prompt-actions">
              <button class="btn-sidebar-icon btn-sidebar-delete" data-prompt-id="${prompt.id}" title="删除">🗑️</button>
            </div>
          </div>
          <div class="prompt-preview" style="color: #ef4444;">此提示词包含无法显示的内容,请删除</div>
        </div>
      `);
    }
  });

  listContainer.innerHTML = items.join('');

  // 为整个提示词项目添加点击事件 - 点击标题或预览内容就复制
  listContainer.querySelectorAll('.prompt-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // 如果点击的是按钮，则不触发复制操作
      if (e.target.closest('.prompt-actions')) {
        return;
      }

      try {
        const id = item.dataset.id;
        if (id && id !== 'error') {
          usePrompt(parseFloat(id));
        }
      } catch (err) {
        console.error('点击复制提示词失败:', err);
        showToast('❌ 操作失败');
      }
    });
  });

  listContainer.querySelectorAll('.btn-sidebar-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const id = btn.dataset.promptId;
        if (id && id !== 'error') {
          editPrompt(parseFloat(id));
        }
      } catch (err) {
        console.error('编辑提示词失败:', err);
        showToast('❌ 操作失败');
      }
    });
  });

  listContainer.querySelectorAll('.btn-sidebar-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const id = btn.dataset.promptId;
        if (id && id !== 'error') {
          deletePrompt(parseFloat(id));
        } else {
          showToast('❌ 无法删除: ID无效');
        }
      } catch (err) {
        console.error('删除按钮出错:', err);
        showToast('❌ 操作失败');
      }
    });
  });

  // 绑定置顶按钮点击事件
  listContainer.querySelectorAll('.btn-sidebar-pin').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const id = btn.dataset.promptId;
        if (id && id !== 'error') {
          togglePinPrompt(parseFloat(id));
        }
      } catch (err) {
        console.error('置顶提示词失败:', err);
        showToast('❌ 置顶失败');
      }
    });
  });
}

// 过滤提示词
function filterPrompts(prompts = null) {
  const searchTerm = document.getElementById('search-input').value.toLowerCase();

  // 如果没有传递提示词数组，则从存储中获取
  if (prompts === null) {
    chrome.storage.local.get(['prompts'], (result) => {
      filterPrompts(result.prompts || []);
    });
    return;
  }

  const filtered = prompts.filter(p => {
    // 类型筛选
    const matchesType = sidebarSelectedTypes.size === 0 ||
      (p.type && sidebarSelectedTypes.has(p.type));

    // 分类筛选
    const matchesCategory = sidebarSelectedCategories.size === 0 ||
      (p.category && sidebarSelectedCategories.has(p.category));

    // 搜索关键词筛选
    if (!searchTerm) {
      return matchesType && matchesCategory;
    }

    // 将搜索词按空格、英文逗号、中文逗号拆分，并过滤掉空字符串
    const searchTerms = searchTerm.split(/[\s,，]+/).filter(term => term.trim() !== '');

    // 检查提示词是否包含所有搜索关键词
    const matchesAllSearchTerms = searchTerms.every(term => {
      return (p.title && p.title.toLowerCase().includes(term)) ||
        (p.content && p.content.toLowerCase().includes(term)) ||
        (p.type && p.type.toLowerCase().includes(term)) ||
        (p.category && p.category.toLowerCase().includes(term)) ||
        (p.tags && p.tags.some(tag => tag.toLowerCase().includes(term)));
    });

    return matchesType && matchesCategory && matchesAllSearchTerms;
  });

  // 对筛选后的提示词进行排序，确保有pinOrder的提示词排在前面
  filtered.sort((a, b) => {
    // 有pinOrder的提示词排在前面
    if (a.pinOrder !== undefined && a.pinOrder !== null && (b.pinOrder === undefined || b.pinOrder === null)) {
      return -1;
    }
    if ((a.pinOrder === undefined || a.pinOrder === null) && b.pinOrder !== undefined && b.pinOrder !== null) {
      return 1;
    }
    // 都有pinOrder的话，按pinOrder升序排列，pinOrder相同则按ID降序排列
    if (a.pinOrder !== undefined && a.pinOrder !== null && b.pinOrder !== undefined && b.pinOrder !== null) {
      if (a.pinOrder !== b.pinOrder) {
        return a.pinOrder - b.pinOrder;
      }
      return b.id - a.id;
    }
    // 都没有pinOrder的话，按ID降序排列（最新的在前）
    return b.id - a.id;
  });

  renderPrompts(filtered);
}

// 显示编辑模态框
function showEditModal(prompt = null, prefilledContent = null) {
  const modal = document.getElementById('edit-modal');
  const title = document.getElementById('modal-title');
  const form = document.getElementById('prompt-form');

  // 统一标题为"编辑提示词"
  title.textContent = '编辑提示词';

  if (prompt) {
    // 编辑现有提示词
    document.getElementById('prompt-title').value = prompt.title;
    document.getElementById('prompt-type').value = prompt.type || '';
    document.getElementById('prompt-category').value = prompt.category || '';
    document.getElementById('prompt-tags').value = prompt.tags ? prompt.tags.join(', ') : '';
    document.getElementById('prompt-content').value = prompt.content;
    form.dataset.editId = prompt.id;
  } else {
    // 新建提示词
    form.reset();
    delete form.dataset.editId;

    // 如果有预填充内容(来自右键收藏)
    if (prefilledContent) {
      document.getElementById('prompt-content').value = prefilledContent;
      // 自动生成标题(取前30个字符)
      const autoTitle = prefilledContent.substring(0, 30).replace(/\n/g, ' ');
      document.getElementById('prompt-title').value = autoTitle + (prefilledContent.length > 30 ? '...' : '');
      // 聚焦到标题输入框
      setTimeout(() => {
        document.getElementById('prompt-title').select();
      }, 100);
    }
  }

  modal.style.display = 'flex';
}

// 隐藏编辑模态框
function hideEditModal() {
  document.getElementById('edit-modal').style.display = 'none';
  document.getElementById('prompt-form').reset();
}

// 保存提示词
function savePrompt(e) {
  e.preventDefault();

  const form = e.target;
  const title = document.getElementById('prompt-title').value.trim();
  const type = document.getElementById('prompt-type').value.trim();
  const category = document.getElementById('prompt-category').value.trim();
  const tagsStr = document.getElementById('prompt-tags').value.trim();
  const content = document.getElementById('prompt-content').value.trim();
  const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(t => t) : [];

  const prompt = {
    title,
    type,
    category,
    tags,
    content
  };

  chrome.storage.local.get(['prompts'], (result) => {
    let prompts = result.prompts || [];

    // 找到当前最小的pinOrder值
    let minPinOrder = 0;
    prompts.forEach(p => {
      if (p.pinOrder !== undefined && p.pinOrder !== null && p.pinOrder < minPinOrder) {
        minPinOrder = p.pinOrder;
      }
    });

    if (form.dataset.editId) {
      // 编辑现有提示词
      const id = parseInt(form.dataset.editId);
      prompts = prompts.map(p => {
        if (p.id === id) {
          // 设置新的pinOrder值，相当于点击了置顶按钮
          return { ...prompt, id, pinOrder: minPinOrder - 1 };
        }
        return p;
      });
    } else {
      // 新建提示词
      prompt.id = Date.now();
      // 设置pinOrder值为当前最小的减1，确保新创建的提示词置顶
      prompt.pinOrder = minPinOrder - 1;
      prompts.push(prompt);
    }

    chrome.storage.local.set({ prompts }, () => {
      hideEditModal();
      loadPrompts();
      showToast(form.dataset.editId ? '✅ 提示词已更新' : '✅ 提示词已创建');
    });
  });
}

// 使用提示词 - 复制到剪贴板
function usePrompt(id) {
  // 先获取直接插入开关的状态
  chrome.storage.local.get(['prompts'], (result) => {
    const prompts = result.prompts || [];
    const prompt = prompts.find(p => p.id === id);

    if (prompt) {
      // 无论是否固定，都只复制到剪贴板
      navigator.clipboard.writeText(prompt.content).then(() => {
        showToast('✅ 已复制到剪贴板');
      }).catch(err => {
        console.error('复制失败:', err);
        showToast('❌ 操作失败,请手动复制');
      });
    }
  });
}

// 编辑提示词
function editPrompt(id) {
  chrome.storage.local.get(['prompts'], (result) => {
    const prompts = result.prompts || [];
    const prompt = prompts.find(p => p.id === id);
    if (prompt) {
      showEditModal(prompt);
    }
  });
}

// 删除提示词 - 增强版
function deletePrompt(id) {
  if (!id) {
    showToast('❌ 删除失败: ID无效');
    return;
  }

  chrome.storage.local.get(['prompts'], (result) => {
    const prompts = result.prompts || [];

    // 确保ID是数字类型
    const numId = typeof id === 'string' ? parseFloat(id) : id;
    const prompt = prompts.find(p => p.id === numId || p.id === id);

    // 安全获取标题预览
    let titlePreview = '此提示词';
    try {
      if (prompt && prompt.title) {
        const safeTitle = String(prompt.title).substring(0, 30);
        titlePreview = safeTitle + (String(prompt.title).length > 30 ? '...' : '');
      }
    } catch (err) {
      titlePreview = `ID: ${id}`;
    }

    if (!confirm(`确定要删除 "${titlePreview}" 吗?\n\n即使内容显示异常也可以删除。`)) {
      return;
    }

    // 执行删除
    try {
      const filtered = prompts.filter(p => {
        // 严格比较ID
        return p.id !== numId && p.id !== id;
      });

      chrome.storage.local.set({ prompts: filtered }, () => {
        if (chrome.runtime.lastError) {
          console.error('存储错误:', chrome.runtime.lastError);
          showToast('❌ 删除失败,请重试');
        } else {
          loadPrompts();
          showToast('🗑️ 已删除提示词');
        }
      });
    } catch (err) {
      console.error('删除出错:', err);
      showToast('❌ 删除失败: ' + err.message);
    }
  });
}

// 查找输入框 - 支持多种网站
function findDoubaoInputBox() {
  // 1. 优先检查当前获得焦点的元素是否是有效的输入框
  const activeElement = document.activeElement;
  if (activeElement) {
    // 检查是否是有效的输入元素
    const isInput = (activeElement.tagName === 'INPUT' && (activeElement.type === 'text' || activeElement.type === 'textarea' || activeElement.type === 'search')) ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.isContentEditable ||
      activeElement.getAttribute('role') === 'textbox';

    // 检查是否可见
    const rect = activeElement.getBoundingClientRect();
    if (isInput && rect.width > 100 && rect.height > 20 && activeElement.offsetParent !== null) {
      return activeElement;
    }
  }

  // 2. 如果没有获得焦点的输入框，再按选择器顺序查找
  const selectors = [
    // 豆包
    'textarea[placeholder*="输入"]',
    'textarea[class*="input"]',
    // ChatGPT
    'textarea[placeholder*="Message"]',
    'textarea[id*="prompt"]',
    // 通用
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea[role="textbox"]',
    'textarea',
    '[role="textbox"]',
    // 富文本编辑器
    '.ql-editor',
    '.ProseMirror',
    '[contenteditable="true"]'
  ];

  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    // 过滤掉隐藏的和很小的输入框
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 20 &&
        element.offsetParent !== null) { // 确保可见
        return element;
      }
    }
  }
  return null;
}

// 向输入框插入文本 - 支持多种类型
function insertTextToDoubao(element, text) {
  if (!element) return false;

  try {
    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      // 标准input/textarea
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.focus();
      return true;
    } else if (element.contentEditable === 'true') {
      // contenteditable元素
      if (element.innerText !== undefined) {
        element.innerText = text;
      } else {
        element.textContent = text;
      }

      // 触发多种事件以确保兼容性
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));

      // 设置光标到末尾
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(element);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);

      element.focus();
      return true;
    }
  } catch (err) {
    console.error('插入文本失败:', err);
  }

  return false;
}

// 导入CSV
function importCSV() {
  document.getElementById('csv-file-input').click();
}

// 处理CSV文件
function handleCSVFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (event) {
    const csv = event.target.result;
    const prompts = parseCSV(csv);

    if (prompts.length === 0) {
      showToast('❌ CSV文件为空或格式不正确');
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
        showToast(`✅ 成功导入 ${newPrompts.length} 条提示词`);
        loadPrompts();
      });
    });
  };

  reader.onerror = function () {
    showToast('❌ 文件读取失败,请重试');
  };

  // 尝试多种编码读取
  reader.readAsText(file, 'UTF-8');
  e.target.value = ''; // 清空input以便重复导入
}

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
            title: sanitizeText(currentLine[0]) || '未命名',
            type: sanitizeText(currentLine[1]) || '',
            category: sanitizeText(currentLine[2]) || '',
            tags: currentLine[3] ? currentLine[3].split('|').map(t => sanitizeText(t)).filter(t => t) : [],
            content: sanitizeText(currentLine[4]) || ''
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
          title: sanitizeText(currentLine[0]) || '未命名',
          type: sanitizeText(currentLine[1]) || '',
          category: sanitizeText(currentLine[2]) || '',
          tags: currentLine[3] ? currentLine[3].split('|').map(t => sanitizeText(t)).filter(t => t) : [],
          content: sanitizeText(currentLine[4]) || ''
        });
      }
    }

    return prompts;
  } catch (err) {
    console.error('CSV解析错误:', err);
    return [];
  }
}

// 清理和验证文本
function sanitizeText(text) {
  if (!text) return '';
  // 移除BOM和特殊字符
  text = text.replace(/^\uFEFF/, '').trim();
  // 确保是有效的字符串
  return String(text);
}

// 解析CSV行(处理引号和逗号)
function parseCSVLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }

  fields.push(field);
  return fields.map(f => f.trim());
}

// 导出CSV
function exportCSV() {
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
}

// CSV转义
function escapeCSV(str) {
  if (!str) return '""';
  str = String(str);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return '"' + str + '"';
}

// HTML转义
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// 显示提示消息
function showToast(message) {
  // 移除已存在的toast
  const existingToast = document.getElementById('doubao-toast');
  if (existingToast) {
    existingToast.remove();
  }

  // 创建新toast
  const toast = document.createElement('div');
  toast.id = 'doubao-toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: rgba(0, 0, 0, 0.85);
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    z-index: 10000000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: slideInDown 0.3s ease, fadeOut 0.3s ease 2.7s;
  `;

  // 添加动画样式
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideInDown {
      from {
        transform: translateY(-100%);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }
    @keyframes fadeOut {
      to {
        opacity: 0;
        transform: translateY(-20px);
      }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(toast);

  // 3秒后自动移除
  setTimeout(() => {
    if (toast && toast.parentNode) {
      toast.remove();
    }
  }, 3000);
}

// 右键收藏选中文本为提示词
function saveSelectionAsPrompt(text) {
  if (!text || text.trim().length === 0) {
    showToast('❌ 未选中文本');
    return;
  }

  // 限制长度
  const maxLength = 5000;
  if (text.length > maxLength) {
    text = text.substring(0, maxLength);
    showToast('⚠️ 文本过长,已截取前5000字');
  }

  // 打开弹窗并显示编辑界面
  if (!isPopupOpen) {
    openPopup();
  }

  // 等待弹窗加载完成
  setTimeout(() => {
    showEditModal(null, text);
  }, 100);
}

// 清空所有提示词
function clearAllPrompts() {
  chrome.storage.local.get(['prompts'], (result) => {
    const prompts = result.prompts || [];

    if (prompts.length === 0) {
      showToast('⚠️ 没有提示词可清空');
      return;
    }

    if (!confirm(`⚠️ 确定要清空所有 ${prompts.length} 条提示词吗?\n\n此操作不可恢复!\n\n建议先导出备份。`)) {
      return;
    }

    if (!confirm(`🚨 最后确认: 真的要删除全部 ${prompts.length} 条提示词吗?`)) {
      return;
    }

    chrome.storage.local.set({ prompts: [] }, () => {
      if (chrome.runtime.lastError) {
        showToast('❌ 清空失败');
      } else {
        loadPrompts();
        showToast('✅ 已清空所有提示词');
      }
    });
  });
}
