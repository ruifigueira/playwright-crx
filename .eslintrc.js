module.exports = {
  extends: './playwright/.eslintrc.js',
  rules: {
    // copyright
    'notice/notice': [2, {
      'mustMatch': 'Copyright',
      'templateFile': require('path').join(__dirname, 'utils', 'copyright.js'),
    }],
  },
};