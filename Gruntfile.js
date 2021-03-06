var javadetect = require('grunt-html/lib/javadetect');
var jar = require('vnu-jar');
var portastic = require('portastic');

module.exports = function (grunt) {
  require('load-grunt-tasks')(grunt);
  var Handlebars = require('handlebars');

  grunt.initConfig({
    // config vars
    elementsJSON: grunt.file.readJSON("src/elements-roles.json"),
    ariaJSON: grunt.file.readJSON("src/roles-states.json"),
    template: grunt.file.read("src/templates/role-test.handlebars"),
    compactTemplate: grunt.file.read("src/templates/role-test-compact.handlebars"),
    //megaTest: true,
    // tasks
    prompt: {
      init: {
        options: {
          questions: [{
            config: "test",
            type: "list",
            message: "choose a task",
            default: "test",
            choices: [
              { name: "Create Individual Test Cases", value: "test" },
              { name: "Validate Individual Test Cases", value: "validate" },
              { name: "Generate Mistakes Report for Individual Test Cases", value: "report" },
              { name: "All of the Above", value: "full" },
              // "---",
              // { name: "Create Mega Test Case", value: "mega" },
              // { name: "Validate Mega Test Case", value: "validate:mega" },
              // { name: "Generate Mistakes Report for Mega Test Case", value: "report:mega" },
              // { name: "All of the Above (Mega)", value: "fullmega" }
            ]
          }],
          then: function (results, done) {
            grunt.task.run(results.test);
            done();
          }
        }
      }
    },
    clean: {
      dist: ['dist/*'],
      testcases: ['dist/testcases/'],
      validation: ['dist/validation/'],
      report: ['dist/validator-mistakes.html'],
      mega: ["dist/testcases/mega-test.min.html", "dist/testcases/mega-test.html"]

    },
    vnuserver: {},
    htmlmin: {
      mega: {
        options: {
          removeComments: true,
          collapseWhitespace: true
        },
        files: {
          "dist/testcases/mega-test.min.html": ["dist/testcases/mega-test.html"]
        }
      }
    },
    htmllint: {
      all: {
        options: {
          errorLevels: ['error', 'warning'],
          reporter: "json",
          force: true,
          ignore: /(.*is missing required attribute.*)|(.*must be contained in.*)|(.*is not (yet )?supported in all browsers.*)|(.*is missing one or more of the following attributes.*)|(.*not allowed as child of element.*)|(.*element being open.*)|(.*Stray (start|end) tag.*)|(.*empty.*)|(.*element must have a.*)|(.*must have attribute.*)|(.*is missing a required instance.*)|(.*does not need a.*)|(.*element is obsolete.*)|(.*consider.*)|(.*format.*)|(.*Duplicate ID.*)/i,
          reporterOutput: "dist/validation/<%= grunt.task.current.args[0] %>.json"
        },
        src: `dist/testcases/<%= grunt.task.current.args[0] %>`
      }
    }
  });

  // Main Grunt Tasks 

  grunt.registerTask("default", "Provide Options", ['prompt:init']);
  grunt.registerTask("test", "Generate test files", ['clean:testcases', 'build-tests']);
  grunt.registerTask("validate", "perform validation and store results", ['clean:validation', 'vnuserver', 'multi-validate']);

  grunt.registerTask("report", "check validation resuls for mistake and create report", ['clean:report', 'create-report']);
  grunt.registerTask("full", "Generate test files, validate them, create report", ['test', 'validate', 'report']);
  //grunt.registerTask("mega", "Generate one big test file", ['clean:mega', 'build-test', 'htmlmin:mega']);
  //grunt.registerTask("full-mega", "Generate one big test file, validate it, create report", ['mega', 'validate', 'report:megaTest']);

  grunt.registerTask("build-test", "Create a single test case based on template", function (elementId) {
    grunt.config.requires('ariaJSON', 'elementsJSON');
    var elementsJSON = grunt.config('elementsJSON');
    var ariaJSON = grunt.config('ariaJSON');
    var megaTest = !elementId;
    var template = grunt.config(megaTest ? 'compactTemplate' : 'template');
    var elementsToTest = {};
    var title = "";

    if (megaTest) { // one test for all elements
      elementsToTest = elementsJSON;
      title = "all elements";
      grunt.log.write(`Building mega test case...`);
    } else { // one test for one element
      grunt.log.write(`Building ${elementId} test case...`);
      elementsToTest[elementId] = elementsJSON[elementId];
      title = elementsJSON[elementId].name;
    }

    var context = {
      elementsToTest: elementsToTest,
      title: title,
      ariaJSON: ariaJSON
    };
    compileTemplate(elementId, template, context);
    grunt.log.ok();
  });

  grunt.registerTask("build-tests", "loop over elements and create test file for each", function () {
    grunt.config.requires('elementsJSON');
    var elementsJSON = grunt.config('elementsJSON');
    for (let elementId in elementsJSON) {
      grunt.task.run(`build-test:${elementId}`);
    }
  });

  grunt.registerTask("multi-validate", "validate all test cases and store the results", function () {
    var tasks = [];
    grunt.log.write('validating all test cases...');
    // Loop over all testcase files, queue up htmllint tasks for each and run them
    grunt.file.recurse("dist/testcases", function (abspath, rootdir, subdir, filename) {
      tasks.push(`htmllint:all:${filename}`);
    });
    grunt.task.run(tasks);
  });

  grunt.registerTask("create-report", "check validation results for mistakes and create reports", function () {
    grunt.config.requires('elementsJSON', 'ariaJSON');
    try {
      grunt.log.write("Creating dist/validator-mistakes.html...");
      var reportTemplate = grunt.file.read("src/templates/validator-mistakes.handlebars");
      var reportTemplateCompiled = Handlebars.compile(reportTemplate);
      var elementsJSON = grunt.config('elementsJSON');
      var ariaJSON = grunt.config('ariaJSON');
      if (grunt.config('megaTest')) {
        validatorMistakes = testMegaValidationResults(elementsJSON, ariaJSON);
      } else {
        validatorMistakes = testValidationResults(elementsJSON, ariaJSON);
      }
      var output = reportTemplateCompiled({ validatorMistakes: validatorMistakes });
      grunt.file.write(`dist/validator-mistakes.html`, output);
      grunt.log.ok();
    } catch (err) {
      grunt.log.error(err);
    }
  });



  // Task copied from https://www.npmjs.com/package/grunt-vnuserver
  // to avoid outdated vnu-jar dependency
  grunt.registerTask('vnuserver', 'Start the Nu Html Checker server.', function () {
    let opt = this.options({ port: 8888, skippable: false, persist: false });
    let done = this.async();
    portastic.test(opt.port, function (open) {
      if (!open) {
        if (opt.skippable) {
          grunt.log.debug('Port ' + opt.port + ' in use. Skipping server startup.');
          done();
        } else {
          done(Error('Port ' + opt.port + ' in use. To ignore, set skippable: false.'));
        }
        return;
      }

      let child;
      let cleanup = function () {
        let killing = grunt.log.write('Killing vnuserver...');
        child.kill('SIGKILL');
        killing.ok();
      };
      if (!opt.persist) {
        process.on('exit', cleanup);
        let exit = grunt.util.exit;
        grunt.util.exit = function () { // This seems to be the only reliable on-exit hook.
          cleanup();
          return exit.apply(grunt.util, arguments);
        };
      }

      javadetect(function (err, java) {
        if (err) {
          throw err;
        }
        if (java.version[0] !== '1' || (java.version[0] === '1' && java.version[2] < '8')) {
          throw new Error('\nUnsupported Java version used: ' + java.version + '. v1.8 is required!');
        }
        let args = [(java.arch === 'ia32' ? '-Xss512k' : ''), '-cp', jar, 'nu.validator.servlet.Main', opt.port].filter(x => x);
        let vnustartup = grunt.log.write('Starting vnuserver...');
        child = grunt.util.spawn({ cmd: 'java', args: args }, function (error, stdout, stderr) {
          if (error && (error.code !== 1 || error.killed || error.signal)) {
            done(false);
          }
        });

        var timer = setTimeout(function () {
          vnustartup.ok();
          done();
        }, 5000); //TODO HH: why doesn't child.stderr.on('data') fire here ? worked fine in vnuserver plugin

        child.stderr.on('data', function (chunk) {
          clearTimeout(timer);
          if (chunk.toString().indexOf('INFO:oejs.Server:main: Started') >= 0) {
            vnustartup.ok();
            done();
          }
          if (chunk.toString().indexOf('java.net.BindException: Address already in use') >= 0) {
            vnustartup.error();
            done(Error('Port ' + opt.port + ' in use. Shutting down.'));
            cleanup();
          }
        });
      });
    });
  });

  // Regular functions

  function testMegaValidationResults() {
    // TODO: there is no way to distinguish validator results 
    // for mutliple test cases involving the same node name,
    // if these results are in the same output doc
  }

  function testValidationResults(elementsJSON, ariaJSON) {

    var validatorMistakes = {};
    var validationResult, allowedRoles;
    var RE1, RE2, nodeName, isAllowed, isAllowedByValidator, isNativeAllowedByValidator, isNativeRole, errorMsg, nativeRoleMistake, roleMistake;
    for (let elementId in elementsJSON) {
      nodeName = elementsJSON[elementId].nodeName;
      grunt.log.write(`Checking ${elementId} results...`);
      try {
        validationResult = grunt.file.read(`dist/validation/${elementId}-test.html.json`);
      } catch (err) {
        grunt.log.error(err);
      }

      allowedRoles = elementsJSON[elementId].allowedRoles;
      nativeRole = elementsJSON[elementId].nativeRole;

      for (let role in ariaJSON.roles) {
        if (ariaJSON.abstract.includes(role)) {
          //No need to test abstract roles
          continue;
        }
        isNativeRole = role === nativeRole;
        RE1 = RegExp(`(Bad value “${role}” for attribute “role” on element “${nodeName}”)|(Attribute “role” not allowed)`);
        RE2 = RegExp(`The “${role}” role is unnecessary for element “${nodeName}”`);
        isAllowed = allowedRoles == "all" || allowedRoles.includes(role) || isNativeRole;
        isAllowedByValidator = !RE1.test(validationResult);
        isNativeAllowedByValidator = RE2.test(validationResult);
        roleMistake = isAllowed !== isAllowedByValidator;
        nativeRoleMistake = isNativeRole !== isNativeAllowedByValidator;
        if (nativeRoleMistake)
          grunt.log.ok(`Native mistake for ${role} role - isNativeRole: ${isNativeRole}, isNativeAllowedByValidator: ${isNativeAllowedByValidator}`);

        if (!nativeRoleMistake && !roleMistake) {
          continue;
        }
        // validator made a mistake

        //Create context for report template 
        if (!validatorMistakes[elementId]) {
          validatorMistakes[elementId] = {
            name: elementsJSON[elementId].name,
            mistakes: []
          };
        }
        if (nativeRoleMistake) {
          errorMsg = `
            <code>role='${role}'</code>
            is 
            <strong>incorrectly</strong>
            ${isNativeAllowedByValidator ? '<strong class="valid">allowed as native role</strong>' : '<strong class="invalid">not indicated as native role</strong>'}
            for 
            <code>${nodeName}</code> element.`;
          let mistake = {
            role: role,
            nodeName: elementsJSON[elementId].nodeName,
            falseNegative: isAllowed,
            errorMsg
          };
          validatorMistakes[elementId].mistakes.push(mistake);
        } else if (roleMistake) {
          errorMsg = `
            <code>role='${role}'</code> 
            <strong>incorrectly</strong>
            flagged as
            ${isAllowedByValidator ? '<strong class="valid">valid</strong>' : '<strong class="invalid">invalid</strong>'}
            for 
            <code>${nodeName}</code> element.`;
          let mistake = {
            role: role,
            nodeName: elementsJSON[elementId].nodeName,
            falseNegative: isAllowed,
            errorMsg
          };
          validatorMistakes[elementId].mistakes.push(mistake);
        }
      }
      grunt.log.ok();
    }
    return validatorMistakes;
  }

  // Apply template for test case and store the result as a html file
  function compileTemplate(elementId, template, context) {
    if (!elementId) {
      elementId = "mega";
    }
    var compiled = Handlebars.compile(template);

    var elementsJSON = grunt.config('elementsJSON');
    var outputHTML = "";

    outputHTML += compiled(context);
    grunt.file.write(`dist/testcases/${elementId}-test.html`, outputHTML);
  }

  function isRoleAllowed(allowedRoles, role) {
    if (typeof allowedRoles === "string" && allowedRoles === "all") {
      return true;
    }
    return allowedRoles.includes(role);
  }

  //Insert role attribute to base markup, optionally with other test attributes
  function insertRoleToMarkup(elementId, role, addRoleOnly, index) {
    grunt.config.requires('elementsJSON');
    var markup = grunt.config('elementsJSON')[elementId].markup;
    if (!markup) {
      return "";
    }
    var attributeString = ` role='${role}'`;
    if (!addRoleOnly) {
      attributeString += ` class='role-test ${role}-test ${elementId}-test' id='${elementId}-${role}-${index}-test' aria-label='acc name' tabindex='0' `;
    }
    // complex base markup can contain {attributeString} to indicate where test attributes should go
    if (markup.includes('{attributeString}')) {
      markup = markup.replace('{attributeString}', `${attributeString}`);
    } else if (markup.includes('/>')) { // self closing element
      markup = markup.replace('/>', `${attributeString}/>`);
    } else { //regular element
      markup = markup.replace('>', `${attributeString}>`);
    }
    return new Handlebars.SafeString(markup);
  }

  function addZeroBefore(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // Template Helpers 

  Handlebars.registerHelper("getDate", function (options) {
    let date = new Date(),
      month = date.toLocaleString("en-us", { month: "long" });
    return `${addZeroBefore(date.getDate())} ${month} ${date.getFullYear()} ${addZeroBefore(date.getHours())}:${addZeroBefore(date.getMinutes())}:${addZeroBefore(date.getSeconds())}`;
  });

  //List of roles in a category
  Handlebars.registerHelper("testlist", function (categoryId, ariaJSON, allowedRoles, elementId, options) {
    var roleList = ariaJSON[categoryId];
    var out = ``;
    for (let i = 0; i < roleList.length; i++) {
      let role = roleList[i];
      var roleAllowed = isRoleAllowed(allowedRoles, role);

      let context = {
        "role": role,
        "elementId": elementId,
        "roleAllowed": roleAllowed,
        "roleIndex": i
      };
      out += options.fn(context);
    }
    return out;
  });

  // list allowed roles
  Handlebars.registerHelper("allowedRolesSection", function (elementId, allowedRoles, options) {
    var isRoleListNeeded = allowedRoles instanceof Array && allowedRoles.length > 0;
    var roleText = "";
    if (!isRoleListNeeded) {
      roleText = typeof allowedRoles === "string" ?
        `<strong><a href="https://w3c.github.io/html-aria/#dfn-any-role">any</a></strong>` :
        `<strong>none</strong>`;
      roleText = new Handlebars.SafeString(roleText);
    }
    var context = {
      elementId: elementId,
      isRoleListNeeded: isRoleListNeeded,
      roleLink: roleText,
      allowedRoles: allowedRoles
    };
    return options.fn(context);
  });

  Handlebars.registerHelper("testElement", function (elementId, role, addRoleOnly, index) {
    var out = insertRoleToMarkup(elementId, role, addRoleOnly, index);
    return out;
  });
};