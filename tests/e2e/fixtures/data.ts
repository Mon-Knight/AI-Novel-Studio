export const E2E_FIXTURES = {
  projectCreate: {
    title: 'E2E Create Open Project',
  },
  projectEdit: {
    originalTitle: 'E2E Project Before Edit',
    updatedTitle: 'E2E Project After Edit',
  },
  chapterSave: {
    projectTitle: 'E2E Chapter Persistence Project',
    volumeTitle: 'E2E Persistence Volume',
    chapterTitle: 'E2E Persistence Chapter',
    content: 'The fixed desktop E2E chapter body persists through navigation and reopening.',
  },
  candidateApply: {
    projectTitle: 'E2E Candidate Review Project',
    mockExpectedFragment: '时间不多了。',
  },
  leaveGuard: {
    projectTitle: 'E2E Leave Guard Project',
    secondChapterTitle: 'E2E Second Chapter',
    unsavedContent: 'The fixed leave guard draft must remain intact until the user chooses how to leave.',
    discardedContent: 'This later unsaved edit must be discarded without replacing or deleting the saved snapshot.',
  },
} as const;
