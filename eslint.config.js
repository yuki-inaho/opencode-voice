export default [
  {
    files: ["index.js", "lib/**/*.js", "test/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": "error",
      "no-undef": "off",
      "no-constant-condition": "warn",
    },
  },
];