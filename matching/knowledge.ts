// Static, reviewable domain knowledge used by the rule-based matcher.
// Everything here is matching vocabulary, never candidate facts: a skill is only
// credited to a candidate when it appears in the reviewed candidate profile.

export type RoleGroup = { id: string; label: string; phrases: string[]; patterns?: string[] };

// Equivalent job-title phrases (French and English). Phrases are accent-folded and lower-case.
export const roleGroups: RoleGroup[] = [
  { id: "data-engineer", label: "Data Engineer", phrases: ["data engineer", "ingenieur data", "ingenieur donnees", "ingenieur big data", "big data engineer", "data engineering", "ingenieur etl", "etl engineer", "analytics engineer", "data platform engineer", "ingenieur bi", "ingenieur decisionnel", "data architect", "architecte data", "architecte donnees"], patterns: ["(?=.*(?<![a-z0-9])data(?![a-z0-9]))(?=.*(engineer|ingenieur))(?!.*(scientist|science|analyst))"] },
  { id: "etl-developer", label: "ETL Developer", phrases: ["developpeur etl", "etl developer", "developer etl", "consultant etl", "consultant bi", "developpeur bi", "bi developer", "developpeur decisionnel", "developpeur ssis", "ssis developer", "developpeur talend", "talend developer", "talend", "ssis", "data integration", "integration de donnees", "integrateur de donnees", "informatica", "datastage", "pentaho"], patterns: ["(?<![a-z0-9])etl(?![a-z0-9])", "(?=.*(develop|integrat|consultant))(?=.*(ssis|talend|informatica|datastage))"] },
  { id: "sql-developer", label: "SQL Server Developer", phrases: ["sql server developer", "developpeur sql server", "developpeur sql", "sql developer", "dba sql", "database developer", "developpeur base de donnees", "developpeur bases de donnees", "t sql", "tsql", "ingenieur sql", "administrateur de bases de donnees", "dba"], patterns: ["(?=.*sql)(?=.*(develop|dba|engineer|ingenieur))"] },
  { id: "azure-data", label: "Azure Data Engineer", phrases: ["azure data engineer", "ingenieur data azure", "azure data factory", "azure synapse", "databricks engineer", "data engineer azure", "ingenieur cloud data", "cloud data engineer", "fabric engineer", "microsoft fabric"], patterns: ["(?=.*azure)(?=.*(?<![a-z0-9])data(?![a-z0-9]))(?=.*(engineer|ingenieur|architect))"] },
  { id: "devops", label: "DevOps Engineer", phrases: ["devops", "ingenieur devops", "devops engineer", "site reliability", "sre", "ingenieur cloud", "cloud engineer", "platform engineer", "ingenieur infrastructure", "ingenieur systemes", "release engineer", "ingenieur ci cd", "ingenieur integration continue", "devsecops"], patterns: ["devops", "(?=.*(cloud|infrastructure|platform))(?=.*(engineer|ingenieur))"] },
  { id: "cpp-developer", label: "C++ Developer", phrases: ["c++ developer", "developpeur c++", "ingenieur c++", "software engineer c++", "c++ software engineer", "c++ engineer", "ingenieur logiciel c++", "developpeur cpp", "cpp developer", "developpeur logiciel embarque", "embedded software engineer"], patterns: ["(?=.*(?<![a-z0-9])c\\+\\+)(?=.*(develop|ingenieur|engineer|logiciel|software))"] },
  { id: "data-analyst", label: "Data Analyst", phrases: ["data analyst", "analyste de donnees", "analyste donnees", "analyste data", "analyste bi", "bi analyst", "business intelligence analyst", "reporting analyst", "analyste reporting", "data analyste"], patterns: ["(?=.*(?<![a-z0-9])data(?![a-z0-9]))(?=.*(analyst|analyste))"] },
  { id: "business-analyst", label: "Business Analyst", phrases: ["business analyst", "analyste metier", "analyste fonctionnel", "analyste d affaires", "analyste business", "functional analyst", "consultant fonctionnel", "assistant maitrise d ouvrage", "amoa", "business systems analyst", "systems analyst", "analyste programmeur", "analyste d etudes"], patterns: ["(?=.*(business|metier|fonctionnel|functional|maitrise d ouvrage))(?=.*(analyst|analyste|consultant))"] },
  { id: "product-definition", label: "Product Definition Analyst", phrases: ["product definition analyst", "product analyst", "analyste produit", "product definition", "definition de produit", "product owner", "product data analyst", "technical product analyst"], patterns: ["(?=.*product)(?=.*(definition|analyst|analyste))"] }
];

export type SkillDef = { id: string; label: string; aliases: string[]; family?: string };

// Canonical technologies with spelling variants. `family` links interchangeable tools for transferable-skill hints.
export const skills: SkillDef[] = [
  { id: "sql", label: "SQL", aliases: ["sql"], family: "sql" },
  { id: "sqlserver", label: "SQL Server", aliases: ["sql server", "mssql", "ms sql", "microsoft sql server", "t-sql", "tsql", "transact-sql", "transact sql"], family: "sql" },
  { id: "postgresql", label: "PostgreSQL", aliases: ["postgresql", "postgres", "psql"], family: "sql" },
  { id: "mysql", label: "MySQL", aliases: ["mysql", "mariadb"], family: "sql" },
  { id: "oracle", label: "Oracle", aliases: ["oracle", "pl/sql", "plsql", "pl sql"], family: "sql" },
  { id: "ssis", label: "SSIS", aliases: ["ssis", "sql server integration services", "integration services"], family: "etl" },
  { id: "ssas", label: "SSAS", aliases: ["ssas", "analysis services"], family: "bi" },
  { id: "ssrs", label: "SSRS", aliases: ["ssrs", "reporting services"], family: "bi" },
  { id: "talend", label: "Talend", aliases: ["talend"], family: "etl" },
  { id: "informatica", label: "Informatica", aliases: ["informatica", "powercenter"], family: "etl" },
  { id: "datastage", label: "DataStage", aliases: ["datastage", "data stage"], family: "etl" },
  { id: "pentaho", label: "Pentaho", aliases: ["pentaho", "kettle"], family: "etl" },
  { id: "adf", label: "Azure Data Factory", aliases: ["azure data factory", "adf"], family: "etl" },
  { id: "airflow", label: "Airflow", aliases: ["airflow", "apache airflow"], family: "etl" },
  { id: "dbt", label: "dbt", aliases: ["dbt"], family: "etl" },
  { id: "etl", label: "ETL", aliases: ["etl", "elt", "data integration", "integration de donnees", "data pipeline", "pipelines de donnees", "pipeline de donnees"], family: "etl" },
  { id: "azure", label: "Azure", aliases: ["azure", "microsoft azure"], family: "cloud" },
  { id: "aws", label: "AWS", aliases: ["aws", "amazon web services"], family: "cloud" },
  { id: "gcp", label: "GCP", aliases: ["gcp", "google cloud"], family: "cloud" },
  { id: "synapse", label: "Azure Synapse", aliases: ["synapse", "azure synapse"], family: "bigdata" },
  { id: "databricks", label: "Databricks", aliases: ["databricks"], family: "bigdata" },
  { id: "spark", label: "Spark", aliases: ["spark", "pyspark", "apache spark"], family: "bigdata" },
  { id: "kafka", label: "Kafka", aliases: ["kafka"], family: "bigdata" },
  { id: "snowflake", label: "Snowflake", aliases: ["snowflake"], family: "bigdata" },
  { id: "hadoop", label: "Hadoop", aliases: ["hadoop", "hive"], family: "bigdata" },
  { id: "fabric", label: "Microsoft Fabric", aliases: ["microsoft fabric", "ms fabric"], family: "bigdata" },
  { id: "python", label: "Python", aliases: ["python"] },
  { id: "java", label: "Java", aliases: ["java"] },
  { id: "csharp", label: "C#", aliases: ["c#", "csharp", "c sharp"] },
  { id: "dotnet", label: ".NET", aliases: [".net", "dotnet", "asp.net"] },
  { id: "cpp", label: "C++", aliases: ["c++", "cpp", "c/c++"], family: "native" },
  { id: "c", label: "C", aliases: ["langage c"], family: "native" },
  { id: "rust", label: "Rust", aliases: ["rust"], family: "native" },
  { id: "powershell", label: "PowerShell", aliases: ["powershell"] },
  { id: "bash", label: "Bash", aliases: ["bash", "shell scripting", "shell unix"] },
  { id: "powerbi", label: "Power BI", aliases: ["power bi", "powerbi"], family: "bi" },
  { id: "tableau", label: "Tableau", aliases: ["tableau"], family: "bi" },
  { id: "qlik", label: "Qlik", aliases: ["qlik", "qlikview", "qlik sense"], family: "bi" },
  { id: "looker", label: "Looker", aliases: ["looker"], family: "bi" },
  { id: "excel", label: "Excel", aliases: ["microsoft excel", "ms excel", "advanced excel", "excel avance", "tableur excel"] },
  { id: "docker", label: "Docker", aliases: ["docker"], family: "containers" },
  { id: "kubernetes", label: "Kubernetes", aliases: ["kubernetes", "k8s", "openshift"], family: "containers" },
  { id: "terraform", label: "Terraform", aliases: ["terraform"], family: "iac" },
  { id: "ansible", label: "Ansible", aliases: ["ansible"], family: "iac" },
  { id: "bicep", label: "Bicep / ARM", aliases: ["bicep", "arm template", "arm templates"], family: "iac" },
  { id: "jenkins", label: "Jenkins", aliases: ["jenkins"], family: "cicd" },
  { id: "gitlabci", label: "GitLab CI", aliases: ["gitlab ci", "gitlab-ci"], family: "cicd" },
  { id: "githubactions", label: "GitHub Actions", aliases: ["github actions"], family: "cicd" },
  { id: "azuredevops", label: "Azure DevOps", aliases: ["azure devops", "tfs", "vsts"], family: "cicd" },
  { id: "cicd", label: "CI/CD", aliases: ["ci/cd", "ci cd", "cicd", "integration continue", "continuous integration", "continuous delivery"], family: "cicd" },
  { id: "git", label: "Git", aliases: ["git", "github", "gitlab"] },
  { id: "linux", label: "Linux", aliases: ["linux", "unix"] },
  { id: "windows", label: "Windows Server", aliases: ["windows server"] },
  { id: "datamodeling", label: "Data modeling", aliases: ["data modeling", "data modelling", "modelisation de donnees", "modelisation", "data warehouse", "datawarehouse", "entrepot de donnees", "star schema", "modele en etoile"] },
  { id: "agile", label: "Agile / Scrum", aliases: ["agile", "scrum", "kanban"] },
  { id: "jira", label: "Jira", aliases: ["jira", "confluence"] },
  { id: "rest", label: "REST APIs", aliases: ["rest api", "restful", "api rest", "web services"] },
  { id: "ml", label: "Machine learning", aliases: ["machine learning", "apprentissage automatique", "deep learning"] },
  { id: "stl", label: "STL / Boost", aliases: ["stl", "boost c++", "boost library"], family: "native" },
  { id: "qt", label: "Qt", aliases: ["qt"], family: "native" },
  { id: "cmake", label: "CMake", aliases: ["cmake"], family: "native" },
  { id: "sap", label: "SAP", aliases: ["sap"] },
  { id: "vba", label: "VBA", aliases: ["vba"] }
];

export type Place = { name: string; aliases?: string[]; lat: number; lon: number; country: "FR" | "LU" | "BE" | "DE"; area: string };

// Approximate city-centre coordinates, used only for commute-distance estimates.
export const places: Place[] = [
  { name: "Nancy", aliases: ["nancy", "technopole nancy-brabois", "brabois"], lat: 48.6921, lon: 6.1844, country: "FR", area: "nancy" },
  { name: "Vandoeuvre-les-Nancy", aliases: ["vandoeuvre", "vandoeuvre les nancy"], lat: 48.6564, lon: 6.1607, country: "FR", area: "nancy" },
  { name: "Laxou", lat: 48.6861, lon: 6.1428, country: "FR", area: "nancy" },
  { name: "Villers-les-Nancy", aliases: ["villers les nancy"], lat: 48.6667, lon: 6.1458, country: "FR", area: "nancy" },
  { name: "Maxeville", lat: 48.7094, lon: 6.1989, country: "FR", area: "nancy" },
  { name: "Essey-les-Nancy", aliases: ["essey les nancy"], lat: 48.7078, lon: 6.2233, country: "FR", area: "nancy" },
  { name: "Saint-Max", aliases: ["saint max"], lat: 48.7011, lon: 6.2056, country: "FR", area: "nancy" },
  { name: "Tomblaine", lat: 48.6975, lon: 6.2181, country: "FR", area: "nancy" },
  { name: "Jarville-la-Malgrange", aliases: ["jarville"], lat: 48.6600, lon: 6.2050, country: "FR", area: "nancy" },
  { name: "Heillecourt", lat: 48.6300, lon: 6.1900, country: "FR", area: "nancy" },
  { name: "Ludres", lat: 48.6150, lon: 6.1750, country: "FR", area: "nancy" },
  { name: "Houdemont", lat: 48.6130, lon: 6.1830, country: "FR", area: "nancy" },
  { name: "Champigneulles", lat: 48.7311, lon: 6.1692, country: "FR", area: "nancy" },
  { name: "Frouard", lat: 48.7600, lon: 6.1300, country: "FR", area: "nancy" },
  { name: "Pompey", lat: 48.7650, lon: 6.1000, country: "FR", area: "nancy" },
  { name: "Dombasle-sur-Meurthe", aliases: ["dombasle"], lat: 48.6100, lon: 6.3500, country: "FR", area: "nancy" },
  { name: "Luneville", lat: 48.5925, lon: 6.4983, country: "FR", area: "nancy" },
  { name: "Toul", lat: 48.6750, lon: 5.8917, country: "FR", area: "nancy" },
  { name: "Pont-a-Mousson", aliases: ["pont a mousson"], lat: 48.9050, lon: 6.0536, country: "FR", area: "nancy" },
  { name: "Metz", aliases: ["metz", "metz technopole", "technopole metz"], lat: 49.1193, lon: 6.1757, country: "FR", area: "metz" },
  { name: "Woippy", lat: 49.1500, lon: 6.1550, country: "FR", area: "metz" },
  { name: "Montigny-les-Metz", aliases: ["montigny les metz"], lat: 49.0969, lon: 6.1561, country: "FR", area: "metz" },
  { name: "Marly", lat: 49.0700, lon: 6.1550, country: "FR", area: "metz" },
  { name: "Longeville-les-Metz", aliases: ["longeville les metz"], lat: 49.1100, lon: 6.1450, country: "FR", area: "metz" },
  { name: "Saint-Julien-les-Metz", aliases: ["saint julien les metz"], lat: 49.1250, lon: 6.2200, country: "FR", area: "metz" },
  { name: "Augny", lat: 49.0750, lon: 6.1300, country: "FR", area: "metz" },
  { name: "Maizieres-les-Metz", aliases: ["maizieres les metz"], lat: 49.2050, lon: 6.1650, country: "FR", area: "metz" },
  { name: "Hagondange", lat: 49.2450, lon: 6.1650, country: "FR", area: "metz" },
  { name: "Amneville", lat: 49.2561, lon: 6.1397, country: "FR", area: "metz" },
  { name: "Thionville", lat: 49.3575, lon: 6.1681, country: "FR", area: "metz" },
  { name: "Yutz", lat: 49.3550, lon: 6.1950, country: "FR", area: "metz" },
  { name: "Florange", lat: 49.3250, lon: 6.1200, country: "FR", area: "metz" },
  { name: "Fameck", lat: 49.3017, lon: 6.0958, country: "FR", area: "metz" },
  { name: "Forbach", lat: 49.1900, lon: 6.8900, country: "FR", area: "metz" },
  { name: "Saint-Avold", aliases: ["saint avold"], lat: 49.1050, lon: 6.7100, country: "FR", area: "metz" },
  { name: "Sarreguemines", lat: 49.1100, lon: 7.0700, country: "FR", area: "metz" },
  { name: "Luxembourg", aliases: ["luxembourg", "luxembourg city", "luxembourg ville", "kirchberg", "gasperich", "cloche d or", "hamm", "limpertsberg", "bonnevoie", "grand duche de luxembourg", "grand duchy of luxembourg"], lat: 49.6117, lon: 6.1319, country: "LU", area: "luxembourg" },
  { name: "Esch-sur-Alzette", aliases: ["esch sur alzette", "belval", "esch belval"], lat: 49.4958, lon: 5.9806, country: "LU", area: "luxembourg" },
  { name: "Strassen", lat: 49.6200, lon: 6.0700, country: "LU", area: "luxembourg" },
  { name: "Bertrange", lat: 49.6100, lon: 6.0500, country: "LU", area: "luxembourg" },
  { name: "Leudelange", lat: 49.5700, lon: 6.0600, country: "LU", area: "luxembourg" },
  { name: "Howald", lat: 49.5800, lon: 6.1450, country: "LU", area: "luxembourg" },
  { name: "Mamer", lat: 49.6270, lon: 6.0250, country: "LU", area: "luxembourg" },
  { name: "Capellen", lat: 49.6450, lon: 5.9890, country: "LU", area: "luxembourg" },
  { name: "Munsbach", aliases: ["munsbach", "contern"], lat: 49.6000, lon: 6.2300, country: "LU", area: "luxembourg" },
  { name: "Hesperange", lat: 49.5700, lon: 6.1500, country: "LU", area: "luxembourg" },
  { name: "Differdange", lat: 49.5250, lon: 5.8890, country: "LU", area: "luxembourg" },
  { name: "Dudelange", lat: 49.4800, lon: 6.0870, country: "LU", area: "luxembourg" },
  { name: "Bettembourg", lat: 49.5190, lon: 6.1050, country: "LU", area: "luxembourg" },
  { name: "Walferdange", lat: 49.6560, lon: 6.1330, country: "LU", area: "luxembourg" },
  { name: "Mersch", lat: 49.7480, lon: 6.1070, country: "LU", area: "luxembourg" },
  { name: "Strasbourg", lat: 48.5734, lon: 7.7521, country: "FR", area: "grand-est" },
  { name: "Reims", lat: 49.2583, lon: 4.0317, country: "FR", area: "grand-est" },
  { name: "Mulhouse", lat: 47.7508, lon: 7.3359, country: "FR", area: "grand-est" },
  { name: "Colmar", lat: 48.0794, lon: 7.3580, country: "FR", area: "grand-est" },
  { name: "Epinal", lat: 48.1736, lon: 6.4497, country: "FR", area: "grand-est" },
  { name: "Troyes", lat: 48.2973, lon: 4.0744, country: "FR", area: "grand-est" },
  { name: "Charleville-Mezieres", aliases: ["charleville mezieres", "charleville"], lat: 49.7620, lon: 4.7200, country: "FR", area: "grand-est" },
  { name: "Verdun", lat: 49.1600, lon: 5.3830, country: "FR", area: "grand-est" },
  { name: "Paris", aliases: ["paris", "ile de france", "la defense", "boulogne billancourt", "issy les moulineaux", "levallois perret"], lat: 48.8566, lon: 2.3522, country: "FR", area: "ile-de-france" },
  { name: "Lyon", lat: 45.7640, lon: 4.8357, country: "FR", area: "auvergne-rhone-alpes" },
  { name: "Lille", lat: 50.6292, lon: 3.0573, country: "FR", area: "hauts-de-france" },
  { name: "Marseille", lat: 43.2965, lon: 5.3698, country: "FR", area: "paca" },
  { name: "Toulouse", lat: 43.6047, lon: 1.4442, country: "FR", area: "occitanie" },
  { name: "Bordeaux", lat: 44.8378, lon: -0.5792, country: "FR", area: "nouvelle-aquitaine" },
  { name: "Nantes", lat: 47.2184, lon: -1.5536, country: "FR", area: "pays-de-la-loire" },
  { name: "Brussels", aliases: ["brussels", "bruxelles"], lat: 50.8503, lon: 4.3517, country: "BE", area: "belgium" },
  { name: "Saarbrucken", aliases: ["saarbrucken", "sarrebruck"], lat: 49.2402, lon: 6.9969, country: "DE", area: "germany" },
  { name: "Trier", aliases: ["trier", "treves"], lat: 49.7596, lon: 6.6441, country: "DE", area: "germany" }
];

// Region / country phrases that are not point locations.
export const areaAliases: Record<string, string[]> = {
  "grand-est": ["grand est", "lorraine", "alsace", "champagne ardenne", "meurthe et moselle", "moselle", "meuse", "vosges", "bas rhin", "haut rhin", "marne", "aube", "ardennes", "haute marne"],
  luxembourg: ["luxembourg", "grand duche"],
  france: ["france", "francais", "metropolitan france"]
};

export const europeanCountryWords = ["europe", "emea", "european union", "eu only", "eea", "united kingdom", "germany", "allemagne", "spain", "espagne", "italy", "italie", "portugal", "netherlands", "pays bas", "belgium", "belgique", "ireland", "irlande", "poland", "pologne", "switzerland", "suisse", "luxembourg", "denmark", "sweden", "austria", "autriche"];
export const nonEuropeWords = ["united states", "usa", "us only", "canada", "india", "inde", "brazil", "bresil", "australia", "singapore", "japan", "apac", "latam", "north america", "new york", "san francisco", "mexico"];

export const languageAliases: Record<string, string[]> = {
  french: ["french", "francais", "francophone", "fr"],
  english: ["english", "anglais", "en"],
  german: ["german", "allemand", "deutsch"],
  dutch: ["dutch", "neerlandais", "nederlands", "flemish"],
  spanish: ["spanish", "espagnol", "espanol"],
  italian: ["italian", "italien"],
  luxembourgish: ["luxembourgish", "luxembourgeois", "letzebuergesch"],
  portuguese: ["portuguese", "portugais"]
};

// French département codes, used to translate preferred locations into France Travail geographic filters.
export const areaDepartments: Record<string, string[]> = {
  nancy: ["54"], metz: ["57"], "grand-est": ["54", "57", "55", "88", "67", "68", "51", "10", "52", "08"], "ile-de-france": ["75", "92", "93", "94", "78", "91", "95", "77"]
};
export const placeDepartments: Record<string, string> = { Strasbourg: "67", Reims: "51", Mulhouse: "68", Colmar: "68", Epinal: "88", Troyes: "10", "Charleville-Mezieres": "08", Verdun: "55", Paris: "75", Lyon: "69", Lille: "59", Marseille: "13", Toulouse: "31", Bordeaux: "33", Nantes: "44" };
